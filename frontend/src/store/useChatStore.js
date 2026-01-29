import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { encryptMessage, decryptMessage } from "../lib/crypto";
import { getPrivateKey } from "../lib/keyManager";

export const useChatStore = create((set, get) => ({
  messages: [],
  users: [],
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  unreadCounts: {}, // Format: { userId: count }
  typingUsers: [], // Array of userIds currently typing to me

  getUsers: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/users");
      set({ users: res.data });
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isUsersLoading: false });
    }
  },

  connectByCode: async (chatCode) => {
    try {
      const res = await axiosInstance.post("/messages/connect-code", { chatCode });
      set({ users: [...get().users, res.data.user] });
      toast.success(res.data.message);
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to connect");
      return false;
    }
  },

  getMessages: async (userId) => {
    set({ isMessagesLoading: true });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`);
      
      // Decrypt Messages Batch
      const privateKey = getPrivateKey();
      const decryptedMessages = await Promise.all(res.data.map(async (msg) => {
         // Only try to decrypt if there's a private key and the message looks like encrypted JSON
         if (!privateKey) return msg;
         try {
           const decryptedText = await decryptMessage(privateKey, msg.text);
           return { ...msg, text: decryptedText };
         } catch (e) {
           return msg;
         }
      }));

      set({ messages: decryptedMessages });
    } catch (error) {
      toast.error(error.response?.data?.message || "Error fetching messages");
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  markMessagesAsRead: async (senderId) => {
    try {
      await axiosInstance.put(`/messages/read/${senderId}`);
      // Locally update messages to read
      set({
        messages: get().messages.map(m => 
          m.senderId === senderId ? { ...m, isRead: true } : m
        )
      });
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  },

  getSuggestions: async (lastMessage) => {
    try {
        const res = await axiosInstance.post("/ai/suggestions", { message: lastMessage });
        return res.data.suggestions;
    } catch (error) {
        console.error("Error fetching suggestions:", error);
        return [];
    }
  },

  sendMessage: async (messageData) => {
    const { selectedUser, messages } = get();
    try {
      // AI Logic (Identified by email)
      if (selectedUser.email === "ai@bot.com") {
          const userMsg = {
            _id: Date.now(),
            senderId: useAuthStore.getState().authUser._id,
            receiverId: selectedUser._id,
            text: messageData.text,
            image: messageData.image,
            createdAt: new Date().toISOString()
        };
        set({ messages: [...messages, userMsg] });

        const res = await axiosInstance.post("/ai/chat", messageData);
        set({ messages: [...get().messages, res.data] });
        return;
      }

      // E2EE Logic: Encrypt for the Receiver AND the Sender
      let textToSend = messageData.text;
      const myPublicKey = useAuthStore.getState().authUser.publicKey;
      if (selectedUser.publicKey) {
         console.log("🔒 Encrypting message for:", selectedUser.fullName);
         textToSend = await encryptMessage(selectedUser.publicKey, messageData.text, myPublicKey);
      }
      
      const payload = { ...messageData, text: textToSend };
      const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, payload);
      
      // Local addition: We use the plain text we typed so we can see our own message
      const displayedMessage = { ...res.data, text: messageData.text };
      set({ messages: [...get().messages, displayedMessage] });
    } catch (error) {
      toast.error(error.response?.data?.message || "Error sending message");
    }
  },

  subscribeToMessages: () => {
    const socket = useAuthStore.getState().socket;
    if (!socket) return;

    socket.on("newMessage", async (newMessage) => {
      const { selectedUser, messages, users } = get();
      
      // Decrypt incoming message
      const privateKey = getPrivateKey();
      let decryptedText = newMessage.text;
      if (privateKey && newMessage.text.startsWith('{')) {
        try {
          decryptedText = await decryptMessage(privateKey, newMessage.text);
        } catch (e) {
          console.warn("Decryption failed");
        }
      }

      const messageWithText = { ...newMessage, text: decryptedText };

      // 1. If it's from the active chat, just add it to the UI
      if (selectedUser && newMessage.senderId === selectedUser._id) {
        const isDuplicate = messages.some(m => m._id === messageWithText._id);
        if (!isDuplicate) {
            set({
              messages: [...messages, messageWithText],
            });
        }
      } else {
        // Increment Unread Count
        set({
          unreadCounts: {
            ...get().unreadCounts,
            [newMessage.senderId]: (get().unreadCounts[newMessage.senderId] || 0) + 1,
          },
        });

        // 2. If it's from someone else, show a notification
        const sender = users.find(u => u._id === newMessage.senderId);
        const senderName = sender ? sender.fullName : "New Message";
        
        // Notification Sound
        const audio = new Audio("https://res.cloudinary.com/dpgu739is/video/upload/v1711200000/notification_sound.mp3");
        audio.play().catch(e => console.log("Audio play blocked"));

        // Toast Notification
        toast.success(`${senderName}: ${decryptedText.substring(0, 30)}${decryptedText.length > 30 ? "..." : ""}`, {
          duration: 3000,
          position: "top-right",
          icon: "💬"
        });

        // Browser Native Notification
        if (Notification.permission === "granted") {
          new Notification(senderName, {
            body: decryptedText,
            icon: sender?.profilePic || "/avatar.png"
          });
        }
      }
    });

    socket.on("userTyping", ({ senderId }) => {
      if (!get().typingUsers.includes(senderId)) {
        set({ typingUsers: [...get().typingUsers, senderId] });
      }
    });

    socket.on("userStoppedTyping", ({ senderId }) => {
      set({ typingUsers: get().typingUsers.filter(id => id !== senderId) });
    });

    socket.on("messagesSeen", ({ seenBy }) => {
      const { selectedUser, messages } = get();
      if (selectedUser && seenBy === selectedUser._id) {
        set({
          messages: messages.map(m => ({ ...m, isRead: true }))
        });
      }
    });
  },

  unsubscribeFromMessages: () => {
    const socket = useAuthStore.getState().socket;
    if (socket) {
        socket.off("newMessage");
        socket.off("userTyping");
        socket.off("userStoppedTyping");
        socket.off("messagesSeen");
    }
  },

  setSelectedUser: (selectedUser) => {
    set({ selectedUser });
    if (selectedUser) {
      set({
        unreadCounts: {
          ...get().unreadCounts,
          [selectedUser._id]: 0,
        },
      });
      // Call mark as read API
      get().markMessagesAsRead(selectedUser._id);
    }
  },
}));
