import { create } from "zustand";
import { axiosInstance } from "../lib/axios.js";
import toast from "react-hot-toast";
import {io} from "socket.io-client"
import { generateKeyPair, storePrivateKey, hasKeys, getPrivateKey, getPublicKey, storePublicKey } from "../lib/keyManager.js";
const BASE_URL = import.meta.env.MODE === "development" ? "http://localhost:8080" : "/";

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isSigningUp: false,
  isLoggingIn: false,
  isUpdatingProfile: false,
  isCheckingAuth: true,
  onlineUsers:[],
  socket: null,

  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/check");

      set({ authUser: res.data });
      get().connectSocket()
      
      // Request Notification Permission
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

      // Generate keys if user doesn't have them
      await get().ensureKeys();
    } catch (error) {
      console.log("Error in checkAuth:", error);
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  ensureKeys: async () => {
    const { authUser } = get();
    const storedPublicKey = getPublicKey();
    const storedPrivateKey = getPrivateKey();

    // 1. Check if we have both keys locally
    if (!storedPublicKey || !storedPrivateKey) {
        console.log("🔑 Keys missing. Generating new pair...");
        const keys = await generateKeyPair();
        if (!keys) return;

        storePrivateKey(keys.privateKey);
        storePublicKey(keys.publicKey);

        // Upload new public key
        try {
            await axiosInstance.put("/auth/update-public-key", { publicKey: keys.publicKey });
            set({ authUser: { ...authUser, publicKey: keys.publicKey } });
            console.log("✅ New keys generated and synced.");
        } catch (error) {
            console.error("Failed to upload new public key:", error);
        }
        return;
    }

    // 2. We have local keys, but do they match the server?
    // If the server has NO key, or a DIFFERENT key, we must push our local public key to be the source of truth
    if (authUser?.publicKey !== storedPublicKey) {
        console.log("⚠️ Key Mismatch detected! Server has old/different key. Syncing local key to server...");
        try {
            await axiosInstance.put("/auth/update-public-key", { publicKey: storedPublicKey });
            set({ authUser: { ...authUser, publicKey: storedPublicKey } });
            console.log("✅ Server synced with local public key.");
        } catch (error) {
            console.error("Failed to sync public key:", error);
        }
    } else {
        console.log("🔒 E2EE Keys are synchronized.");
    }
  },

  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      toast.success("Account created successfully");
      get().connectSocket()
      
      // Generate and upload keys
      await get().ensureKeys();
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isSigningUp: false });
    }
  },

  login: async (data) => {
    set({ isLoggingIn: true });
    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data });
      toast.success("Logged in successfully");
      get().connectSocket()
      
      // Generate keys if not present
      await get().ensureKeys();
      
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
      set({ authUser: null });
      toast.success("Logged out successfully");
      get().disconnectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    }
  },

  updateProfile: async (data) => {
    set({ isUpdatingProfile: true });
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data });
      toast.success("Profile updated successfully");
    } catch (error) {
      console.log("error in update profile:", error);
      toast.error(error.response.data.message);
    } finally {
      set({ isUpdatingProfile: false });
    }
  },
  connectSocket:()=>{
    const {authUser} = get();
    if(!authUser || get().socket?.connected) return;
    const socket = io(BASE_URL,{
      query:{
        userId:authUser._id
      }
    });
    socket.connect();
    set({socket:socket});

    socket.on("getOnlineUsers" , (userIds)=>{
      set({onlineUsers:userIds})
    })
  },
  disconnectSocket:()=>{
    if(get().socket?.connected) get().socket.disconnect();
  }

}));
