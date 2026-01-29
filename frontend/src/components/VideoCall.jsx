import React, { useEffect, useRef, useState } from "react";
import Peer from "simple-peer";
import { useAuthStore } from "../store/useAuthStore";
import { useCallStore } from "../store/useCallStore";
import { useChatStore } from "../store/useChatStore";
import { Phone, PhoneOff, Video, Mic, MicOff, Camera, CameraOff, Loader } from "lucide-react";
import toast from "react-hot-toast";

const VideoCall = () => {
    const { authUser, socket } = useAuthStore();
    const { selectedUser } = useChatStore();
    const { 
        isCallIncoming, 
        isCallActive, 
        caller, 
        callSignal, 
        setCallActive, 
        endCall 
    } = useCallStore();

    const [stream, setStream] = useState(null);
    const [callAccepted, setCallAccepted] = useState(false);
    const [callEnded, setCallEnded] = useState(false);
    
    // Controls
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCamOn, setIsCamOn] = useState(true);

    const myVideo = useRef();
    const userVideo = useRef();
    const connectionRef = useRef();

    // 1. Handle Media Stream (Camera/Mic)
    useEffect(() => {
        if ((isCallActive || isCallIncoming) && !stream) {
            navigator.mediaDevices.getUserMedia({ video: true, audio: true })
                .then((currentStream) => {
                    setStream(currentStream);
                    // Note: We don't set srcObject here anymore because ref might be null
                })
                .catch(err => {
                    console.error("Error accessing media devices:", err);
                    toast.error("Could not access camera/microphone");
                    endCall();
                });
        }
    }, [isCallActive, isCallIncoming, stream]);

    // NEW: Sync stream to video element whenever it mounts
    useEffect(() => {
        if (myVideo.current && stream) {
            myVideo.current.srcObject = stream;
        }
    }, [stream, isCallActive]); // Re-run when stream updates



    // 2. Handle Initiator Logic (Caller Side)
    useEffect(() => {
        // If we are active state, NOT incoming, and have a stream... we are the caller
        if (isCallActive && !isCallIncoming && stream && !callAccepted && !connectionRef.current) {
            
           if(!selectedUser) return;

           const peer = new Peer({
               initiator: true,
               trickle: false,
               stream: stream,
               config: {
                   iceServers: [
                       { urls: "stun:stun.l.google.com:19302" },
                       { urls: "stun:global.stun.twilio.com:3478" }
                   ]
               }
           });

           peer.on("signal", (data) => {
               socket.emit("callUser", {
                   userToCall: selectedUser._id,
                   signalData: data,
                   from: authUser._id,
                   name: authUser.fullName,
                   profilePic: authUser.profilePic
               });
           });

           peer.on("stream", (remoteStream) => {
               if (userVideo.current) {
                   userVideo.current.srcObject = remoteStream;
               }
           });

           socket.on("callAccepted", (signal) => {
               setCallAccepted(true);
               // Prevent signaling if already destroyed
               if(!peer.destroyed) {
                   peer.signal(signal);
               }
           });

           connectionRef.current = peer;
           
           return () => {
               socket.off("callAccepted");
           }
        }
    }, [isCallActive, isCallIncoming, stream, selectedUser]);


    // Handle answering a call (Receiver Side)
    const answerCall = () => {
        if(!stream) return; // Guard: Wait for stream
        
        setCallAccepted(true);
        setCallActive(true);

        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream: stream,
            config: {
                iceServers: [
                    { urls: "stun:stun.l.google.com:19302" },
                    { urls: "stun:global.stun.twilio.com:3478" }
                ]
            }
        });

        peer.on("signal", (data) => {
            socket.emit("answerCall", { signal: data, to: caller._id });
        });

        peer.on("stream", (currentStream) => {
            if (userVideo.current) {
                userVideo.current.srcObject = currentStream;
            }
        });

        // Add error handling
        peer.on("error", (err) => {
            console.error("Peer error:", err);
            toast.error("Call connection failed");
        });

        peer.signal(callSignal);
        connectionRef.current = peer;
    };


    const leaveCall = () => {
        setCallEnded(true);
        if (connectionRef.current) {
            connectionRef.current.destroy();
        }
        
        endCall();
        // Stop all tracks
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setStream(null);
        window.location.reload(); 
    };

    // Toggle Media
    const toggleMic = () => {
        if (stream) {
            stream.getAudioTracks()[0].enabled = !isMicOn;
            setIsMicOn(!isMicOn);
        }
    };

    const toggleCam = () => {
        if (stream) {
            stream.getVideoTracks()[0].enabled = !isCamOn;
            setIsCamOn(!isCamOn);
        }
    };

    if (!isCallIncoming && !isCallActive) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
            
            {/* Videos Area */}
            <div className="relative w-full max-w-5xl h-[70vh] flex flex-col md:flex-row gap-4">
                
                {/* My Video */}
                <div className={`relative transition-all duration-300 ${callAccepted ? 'w-full md:w-1/4 h-48 md:h-auto absolute md:static bottom-4 right-4 z-20 border-2 border-primary rounded-xl shadow-2xl' : 'w-full h-full'}`}>
                   {stream && (
                        <video 
                            playsInline 
                            muted 
                            ref={myVideo} 
                            autoPlay 
                            className="w-full h-full object-cover rounded-xl bg-gray-800" 
                        />
                   )}
                   <p className="absolute bottom-2 left-2 text-white text-xs bg-black/50 px-2 rounded-md font-medium">You</p>
                </div>

                {/* Remote Video */}
                {callAccepted && !callEnded && (
                    <div className="w-full md:w-3/4 h-full bg-gray-900 rounded-xl overflow-hidden shadow-2xl relative">
                        <video 
                            playsInline 
                            ref={userVideo} 
                            autoPlay 
                            className="w-full h-full object-cover" 
                        />
                         <p className="absolute bottom-4 left-4 text-white text-lg font-semibold drop-shadow-md">
                            {isCallIncoming ? caller?.name : selectedUser?.fullName}
                        </p>
                    </div>
                )}

                {/* Incoming Call Overlay */}
                {isCallIncoming && !callAccepted && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-6 bg-gray-800/90 p-10 rounded-3xl animate-pulse shadow-2xl border border-gray-700">
                             <div className="size-32 rounded-full bg-primary/20 flex items-center justify-center">
                                <Phone className="size-16 text-primary" />
                             </div>
                            <div className="text-center">
                                <h3 className="text-3xl font-bold text-white mb-2">{caller?.fullName || caller?.name || "Unknown"}</h3>
                                <p className="text-gray-400">Incoming Video Call...</p>
                            </div>
                            
                            <div className={`flex gap-8 mt-4 ${!stream ? 'opacity-50' : ''}`}>
                                <button 
                                    onClick={answerCall}
                                    disabled={!stream}
                                    className="bg-green-500 hover:bg-green-600 disabled:bg-gray-500 text-white p-6 rounded-full transition-all hover:scale-110 shadow-lg shadow-green-500/30"
                                >
                                    {stream ? <Phone className="size-8" /> : <Loader className="size-8 animate-spin"/>}
                                </button>
                                <button 
                                    onClick={endCall}
                                    className="bg-red-500 hover:bg-red-600 text-white p-6 rounded-full transition-all hover:scale-110 shadow-lg shadow-red-500/30"
                                >
                                    <PhoneOff className="size-8" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                 
                 {/* Calling Overlay (When we are calling) */}
                 {isCallActive && !isCallIncoming && !callAccepted && (
                     <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20">
                         <div className="text-white text-center">
                             <div className="size-24 rounded-full border-4 border-primary animate-ping mx-auto mb-6">
                                 <img src={selectedUser?.profilePic || "/avatar.png"} className="w-full h-full rounded-full object-cover"/>
                             </div>
                             <h3 className="text-2xl font-bold">Calling {selectedUser?.fullName}...</h3>
                         </div>
                         
                         <button 
                            onClick={leaveCall}
                            className="bg-red-600 hover:bg-red-700 p-4 rounded-full mt-8 transition-all hover:scale-110 shadow-lg"
                        >
                            <PhoneOff className="size-8 text-white" />
                        </button>
                     </div>
                 )}

            </div>

            {/* Controls Bar */}
            {callAccepted && (
                <div className="flex items-center gap-8 bg-gray-800/90 backdrop-blur px-10 py-4 rounded-2xl mt-6 shadow-2xl border border-gray-700">
                     <button 
                        onClick={toggleMic}
                        className={`p-4 rounded-full transition-all ${isMicOn ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'} shadow-md`}
                    >
                        {isMicOn ? <Mic /> : <MicOff />}
                    </button>
                    
                    <button 
                        onClick={leaveCall}
                        className="bg-red-600 hover:bg-red-700 p-5 rounded-full transition-all hover:scale-110 shadow-xl shadow-red-600/30"
                    >
                        <PhoneOff className="size-8 text-white" />
                    </button>

                    <button 
                        onClick={toggleCam}
                        className={`p-4 rounded-full transition-all ${isCamOn ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-red-500 hover:bg-red-600 text-white'} shadow-md`}
                    >
                        {isCamOn ? <Camera /> : <CameraOff />}
                    </button>
                </div>
            )}
        </div>
    );
};

export default VideoCall;
