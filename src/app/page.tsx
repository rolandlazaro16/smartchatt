"use client";

import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import EmojiPicker from 'emoji-picker-react';

interface User {
  _id: string;
  username: string;
  name: string;
  phoneNumber: string;
  profilePicture: string;
}

interface Message {
  _id?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  senderId: string;
  receiverId: string;
  createdAt?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://smartchatt.onrender.com';

const formatTime = (dateString?: string) => {
  if (!dateString) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>("");

  const [contacts, setContacts] = useState<User[]>([]);
  const [selectedContact, setSelectedContact] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPhone, setAuthPhone] = useState("");
  const [authFile, setAuthFile] = useState<File | null>(null);

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // --- WebRTC States & Refs ---
  const [callState, setCallState] = useState<"idle" | "calling" | "receiving" | "connected">("idle");
  const [callType, setCallType] = useState<"audio" | "video">("video");
  const [callerData, setCallerData] = useState<any>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // Auto-login from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setCurrentUser(JSON.parse(savedUser));
    }
  }, []);

  // Fetch contacts and setup socket when authenticated
  useEffect(() => {
    if (token && currentUser) {
      fetch(`${API_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => setContacts(Array.isArray(data) ? data : []))
      .catch(console.error);

      socketRef.current = io(API_URL);
      socketRef.current.emit("register_socket", currentUser._id);

      socketRef.current.on("receive_message", (message: Message) => {
        setMessages((prev) => [...prev, message]);
      });

      socketRef.current.on("incoming_call", (data) => {
        setCallState("receiving");
        setCallType(data.callType);
        setCallerData(data);
      });

      socketRef.current.on("call_answered", async (signal) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signal));
          setCallState("connected");
        }
      });

      socketRef.current.on("call_rejected", () => {
        alert("Call was rejected");
        cleanupCall();
      });

      socketRef.current.on("call_ended", () => {
        cleanupCall();
      });

      socketRef.current.on("ice_candidate", async (data) => {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      });

      return () => {
        socketRef.current?.disconnect();
      };
    }
  }, [token, currentUser]);

  // Fetch messages when a contact is selected
  useEffect(() => {
    if (selectedContact && token) {
      fetch(`${API_URL}/api/messages/${selectedContact._id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(data => setMessages(Array.isArray(data) ? data : []))
      .catch(console.error);
    }
  }, [selectedContact, token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const cleanupCall = () => {
    setCallState("idle");
    setCallerData(null);
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => track.stop());
      setRemoteStream(null);
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  };

  const setupPeerConnection = (stream: MediaStream, isInitiator: boolean, contactId: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peerConnectionRef.current = pc;

    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit("ice_candidate", { candidate: event.candidate, to: contactId, from: currentUser?._id });
      }
    };

    return pc;
  };

  const initiateCall = async (type: "audio" | "video") => {
    if (!selectedContact || !currentUser) return;
    setCallType(type);
    setCallState("calling");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: type === "video", audio: true });
      setLocalStream(stream);
      // Wait for React to render the video element if it hasn't already
      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);

      const pc = setupPeerConnection(stream, true, selectedContact._id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketRef.current?.emit("call_user", {
        userToCall: selectedContact._id,
        signalData: offer,
        from: currentUser._id,
        callerName: currentUser.name || currentUser.username,
        callerProfilePic: currentUser.profilePicture,
        callType: type
      });
    } catch (err) {
      console.error("Failed to start call", err);
      cleanupCall();
    }
  };

  const acceptCall = async () => {
    if (!callerData || !currentUser) return;
    setCallState("connected");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: callType === "video", audio: true });
      setLocalStream(stream);
      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);

      const pc = setupPeerConnection(stream, false, callerData.from);
      await pc.setRemoteDescription(new RTCSessionDescription(callerData.signal));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current?.emit("answer_call", { signal: answer, to: callerData.from });
    } catch (err) {
      console.error("Failed to accept call", err);
      cleanupCall();
    }
  };

  const rejectCall = () => {
    if (callerData) {
      socketRef.current?.emit("reject_call", { to: callerData.from });
    }
    cleanupCall();
  };

  const endCall = () => {
    const toId = callState === "calling" || (callState === "connected" && !callerData) ? selectedContact?._id : callerData?.from;
    if (toId) {
      socketRef.current?.emit("end_call", { to: toId });
    }
    cleanupCall();
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    
    let body;
    let headers: HeadersInit = {};

    if (authMode === "register") {
      const formData = new FormData();
      formData.append("username", authUsername);
      formData.append("password", authPassword);
      formData.append("name", authUsername); // Use username as the display name
      formData.append("phoneNumber", authPhone);
      if (authFile) formData.append("profilePicture", authFile);
      body = formData;
    } else {
      body = JSON.stringify({ username: authUsername, password: authPassword });
      headers = { "Content-Type": "application/json" };
    }

    try {
      const res = await fetch(`${API_URL}${endpoint}`, { method: "POST", headers, body });
      const data = await res.json();
      if (res.ok) {
        if (authMode === "register") {
          alert("Registration successful! Please log in with your new account.");
          setAuthMode("login");
          setAuthPassword(""); // Clear password for security
        } else {
          setToken(data.token);
          setCurrentUser(data.user);
          localStorage.setItem("token", data.token);
          localStorage.setItem("user", JSON.stringify(data.user));
        }
      } else {
        alert(data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken("");
    setCurrentUser(null);
    setContacts([]);
    setSelectedContact(null);
  };

  const handleDeleteConversation = async () => {
    if (!selectedContact || !currentUser) return;
    if (!confirm(`Are you sure you want to delete the conversation with ${selectedContact.name || selectedContact.username}?`)) return;

    try {
      const res = await fetch(`${API_URL}/api/messages/${selectedContact._id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setMessages([]);
      } else {
        alert("Failed to delete conversation");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!confirm("Delete this message for me?")) return;

    try {
      const res = await fetch(`${API_URL}/api/messages/message/${msgId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setMessages(prev => prev.filter(m => m._id !== msgId));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendMessage = () => {
    if (!inputValue.trim() || !socketRef.current || !selectedContact || !currentUser) return;

    // Normal text message
    socketRef.current.emit("send_message", {
      text: inputValue,
      senderId: currentUser._id,
      receiverId: selectedContact._id
    });

    setInputValue("");
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSendMessage();
  };

  const onEmojiClick = (emojiObject: any) => {
    setInputValue(prev => prev + emojiObject.emoji);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedContact || !currentUser) return;

    const formData = new FormData();
    formData.append("media", file);
    formData.append("receiverId", selectedContact._id);
    formData.append("mediaType", file.type.startsWith('image/') ? 'image' : 'file');

    try {
      const res = await fetch(`${API_URL}/api/messages/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const message = await res.json();
      if (res.ok) {
        setMessages(prev => [...prev, message]);
        socketRef.current?.emit("send_message", message); // Notify others via socket
      }
    } catch (err) {
      console.error(err);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        if (!selectedContact) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append("media", audioBlob, "voice-message.webm");
        formData.append("receiverId", selectedContact._id);
        formData.append("mediaType", "audio");

        try {
          const res = await fetch(`${API_URL}/api/messages/upload`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: formData
          });
          const message = await res.json();
          if (res.ok) {
            setMessages(prev => [...prev, message]);
            socketRef.current?.emit("send_message", message);
          }
        } catch (err) {
          console.error(err);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } catch (err) {
      console.error("Error accessing mic:", err);
      alert("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const renderMessageContent = (msg: Message) => {
    if (msg.mediaUrl) {
      if (msg.mediaType === 'image') {
        return (
          <div className="flex flex-col">
            <img src={`${API_URL}${msg.mediaUrl}`} alt="Attachment" className="max-w-[200px] sm:max-w-[300px] rounded-md mb-1 cursor-pointer object-cover" />
            {msg.text && <span className="mt-1">{msg.text}</span>}
          </div>
        );
      }
      if (msg.mediaType === 'audio') {
        return <audio controls src={`${API_URL}${msg.mediaUrl}`} className="max-w-[200px] sm:max-w-[250px] h-[40px] outline-none" />;
      }
      if (msg.mediaType === 'file') {
        return (
          <div className="flex flex-col">
            <a href={`${API_URL}${msg.mediaUrl}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-[#f0f2f5] dark:bg-[#202c33] p-3 rounded-md mb-1 text-[#00a884] hover:underline">
              <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path></svg>
              <span>Download File</span>
            </a>
            {msg.text && <span>{msg.text}</span>}
          </div>
        );
      }
    }
    return <span>{msg.text}</span>;
  };

  // ---------------- AUTH UI ----------------
  if (!currentUser) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#eae6df] dark:bg-[#111b21]">
        <div className="bg-white dark:bg-[#202c33] p-8 rounded-xl shadow-md w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-center text-[#111b21] dark:text-[#e9edef]">
            {authMode === "login" ? "Login to SmartChatt" : "Create an Account"}
          </h2>
          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            <input 
              type="text" 
              placeholder="Username" 
              value={authUsername}
              onChange={(e) => setAuthUsername(e.target.value)}
              className="px-4 py-2 border rounded-md dark:bg-[#2a3942] dark:border-[#222d34] dark:text-[#e9edef]"
              required 
              autoComplete={authMode === "login" ? "username" : "off"}
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={authPassword}
              onChange={(e) => setAuthPassword(e.target.value)}
              className="px-4 py-2 border rounded-md dark:bg-[#2a3942] dark:border-[#222d34] dark:text-[#e9edef]"
              required 
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />
            {authMode === "register" && (
              <>
                <input 
                  type="tel" 
                  placeholder="Phone Number" 
                  value={authPhone}
                  onChange={(e) => setAuthPhone(e.target.value)}
                  className="px-4 py-2 border rounded-md dark:bg-[#2a3942] dark:border-[#222d34] dark:text-[#e9edef]"
                  required 
                />
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-[#54656f] dark:text-[#aebac1]">Profile Picture (Optional)</label>
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={(e) => setAuthFile(e.target.files?.[0] || null)}
                    className="text-sm text-[#54656f] dark:text-[#aebac1]"
                  />
                </div>
              </>
            )}
            <button type="submit" className="bg-[#00a884] text-white py-2 rounded-md font-medium hover:bg-[#008f6f]">
              {authMode === "login" ? "Login" : "Register"}
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-[#54656f] dark:text-[#aebac1]">
            {authMode === "login" ? "Don't have an account? " : "Already have an account? "}
            <button 
              className="text-[#00a884] font-medium" 
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthUsername("");
                setAuthPassword("");
                setAuthPhone("");
              }}
            >
              {authMode === "login" ? "Sign up" : "Log in"}
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ---------------- CHAT UI ----------------
  return (
    <div className="flex h-screen w-full bg-[#eae6df] dark:bg-[#111b21] overflow-hidden text-[#111b21] dark:text-[#e9edef]">
      <div className="flex w-full h-full max-w-[1600px] mx-auto xl:py-4 xl:px-4">
        
        {/* Sidebar */}
        <aside className="w-[30%] min-w-[300px] max-w-[400px] bg-white dark:bg-[#111b21] border-r border-[#d1d7db] dark:border-[#222d34] flex flex-col hidden md:flex">
          {/* Sidebar Header */}
          <header className="h-[60px] bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center overflow-hidden shrink-0">
                {currentUser.profilePicture ? (
                  <img src={`${API_URL}${currentUser.profilePicture}`} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <svg viewBox="0 0 24 24" width="24" height="24" className="text-gray-100 fill-current"><path d="M12 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9 11a1 1 0 0 1-2 0v-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v2a1 1 0 0 1-2 0v-2a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v2z"></path></svg>
                )}
              </div>
              <span className="font-medium text-[#111b21] dark:text-[#e9edef]">{currentUser.username}</span>
            </div>
            <div className="flex items-center gap-4 text-[#54656f] dark:text-[#aebac1]">
              <button onClick={handleLogout} title="Logout" className="hover:text-red-500">
                <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current"><path d="M16 17v-3H9v-4h7V7l5 5-5 5M14 2a2 2 0 012 2v2h-2V4H5v16h9v-2h2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2h9z"></path></svg>
              </button>
            </div>
          </header>

          <div className="p-2 bg-white dark:bg-[#111b21] border-b border-[#f2f2f2] dark:border-[#222d34]">
            <div className="flex items-center bg-[#f0f2f5] dark:bg-[#202c33] rounded-lg px-3 py-1">
              <svg viewBox="0 0 24 24" width="20" height="20" className="text-[#54656f] dark:text-[#aebac1] fill-current shrink-0"><path d="M15.009 13.805h-.636l-.22-.219a5.184 5.184 0 0 0 1.256-3.386 5.207 5.207 0 1 0-5.207 5.208 5.183 5.183 0 0 0 3.385-1.255l.221.22v.635l4.004 3.999 1.194-1.195-3.997-4.007zm-5.6-1.195a3.997 3.997 0 1 1 0-7.995 3.997 3.997 0 0 1 0 7.995z"></path></svg>
              <input type="text" placeholder="Search contacts" className="w-full bg-transparent border-none focus:outline-none text-sm px-4 py-1.5 text-[#3b4a54] dark:text-[#d1d7db] placeholder-[#667781] dark:placeholder-[#8696a0]" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-white dark:bg-[#111b21]">
            {contacts.map(contact => (
              <div 
                key={contact._id} 
                onClick={() => setSelectedContact(contact)}
                className={`flex items-center px-3 py-3 cursor-pointer ${selectedContact?._id === contact._id ? 'bg-[#f0f2f5] dark:bg-[#2a3942]' : 'hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]'}`}
              >
                <div className="w-[49px] h-[49px] rounded-full bg-gray-300 dark:bg-gray-600 shrink-0 flex items-center justify-center shadow-sm overflow-hidden">
                  {contact.profilePicture ? (
                    <img src={`${API_URL}${contact.profilePicture}`} alt={contact.name || contact.username} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-white font-bold text-lg">{(contact.name || contact.username).charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="ml-3 flex-1 border-b border-[#f2f2f2] dark:border-[#222d34] pb-3 pt-1">
                  <div className="flex justify-between items-center">
                    <h3 className="text-[17px] font-normal text-[#111b21] dark:text-[#e9edef]">{contact.name || contact.username}</h3>
                  </div>
                  {contact.phoneNumber && <div className="text-[13px] text-[#667781] dark:text-[#8696a0] mt-0.5">{contact.phoneNumber}</div>}
                </div>
              </div>
            ))}
            {contacts.length === 0 && (
              <div className="p-4 text-center text-[#54656f]">No contacts found. Register another account to chat!</div>
            )}
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col bg-[#efeae2] dark:bg-[#0b141a] relative border-l border-[#d1d7db] dark:border-[#222d34]">
          {selectedContact ? (
            <>
              {/* Chat Header */}
              <header className="h-[60px] bg-[#f0f2f5] dark:bg-[#202c33] flex items-center justify-between px-4 shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-3 cursor-pointer">
                  <div className="w-10 h-10 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center shrink-0 overflow-hidden">
                    {selectedContact.profilePicture ? (
                      <img src={`${API_URL}${selectedContact.profilePicture}`} alt={selectedContact.name || selectedContact.username} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-white font-bold">{(selectedContact.name || selectedContact.username).charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-[16px] text-[#111b21] dark:text-[#e9edef] leading-5">{selectedContact.name || selectedContact.username}</span>
                    {selectedContact.phoneNumber && <span className="text-[13px] text-[#667781] dark:text-[#8696a0]">{selectedContact.phoneNumber}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[#54656f] dark:text-[#aebac1]">
                  <button onClick={() => initiateCall("video")} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors" title="Video Call">
                    <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"></path></svg>
                  </button>
                  <button onClick={() => initiateCall("audio")} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors" title="Audio Call">
                    <svg viewBox="0 0 24 24" width="20" height="20" className="fill-current"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.03 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"></path></svg>
                  </button>
                </div>
              </header>

              <div className="absolute inset-0 z-0 opacity-40 dark:opacity-5 pointer-events-none" style={{ backgroundImage: 'url("https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png")', backgroundRepeat: 'repeat' }}></div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-16 py-4 flex flex-col gap-1 z-10 relative">
                <div className="text-center my-4">
                  <span className="inline-block bg-[#ffeecd] dark:bg-[#182229] text-[#54656f] dark:text-[#ffde8e] text-[12.5px] px-3 py-1.5 rounded-lg shadow-sm">
                    🔒 Messages are end-to-end encrypted. No one outside of this chat can read or listen to them.
                  </span>
                </div>

                {messages.length === 0 ? (
                  <div className="text-center text-[#54656f] mt-10">Send a message to start chatting with {selectedContact.name || selectedContact.username}!</div>
                ) : (
                  messages.map((msg, idx) => {
                    // Message format might differ if they were just sent via socket (which doesn't run full populate)
                    // but we store senderId.
                    const isUser = msg.senderId === currentUser._id;
                    return (
                      <div key={msg._id || idx} className={`flex w-full mb-1 ${isUser ? "justify-end" : "justify-start"}`}>
                        <div 
                          onClick={() => msg._id && handleDeleteMessage(msg._id)}
                          className={`relative max-w-[65%] px-2 pt-1.5 pb-2 rounded-lg shadow-sm cursor-pointer ${
                            isUser 
                              ? "bg-[#d9fdd3] dark:bg-[#005c4b] rounded-tr-none text-[#111b21] dark:text-[#e9edef]" 
                              : "bg-white dark:bg-[#202c33] rounded-tl-none text-[#111b21] dark:text-[#e9edef]"
                          }`}>
                          <div className="text-[14.2px] leading-[19px] break-words pr-12 pb-2 pl-1">
                            {renderMessageContent(msg)}
                          </div>
                          <div className="absolute bottom-1 right-2 flex items-center gap-1">
                            <span className="text-[11px] text-[#667781] dark:text-[#8696a0] leading-none mt-1">
                              {formatTime(msg.createdAt)}
                            </span>
                            {isUser && (
                              <svg viewBox="0 0 16 15" width="16" height="15" className="text-[#53bdeb] fill-current ml-0.5">
                                <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.879a.32.32 0 0 1-.484.033l-.358-.325a.319.319 0 0 0-.484.032l-.378.483a.418.418 0 0 0 .036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.879a.32.32 0 0 1-.484.033L1.891 7.769a.366.366 0 0 0-.515.006l-.423.433a.364.364 0 0 0 .006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"></path>
                              </svg>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <div className="h-[62px] px-4 py-2.5 bg-[#f0f2f5] dark:bg-[#202c33] flex items-center gap-4 shrink-0 z-10 relative">
                
                {/* Emoji Picker Popup */}
                {showEmojiPicker && (
                  <div className="absolute bottom-[70px] left-4 z-50 shadow-xl">
                    <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
                  </div>
                )}

                {/* Left Icons: Emoji & Attach */}
                <div className="flex items-center gap-4 text-[#54656f] dark:text-[#8696a0]">
                  <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className={`transition-colors ${showEmojiPicker ? 'text-[#00a884]' : 'hover:text-[#111b21] dark:hover:text-[#d1d7db]'}`} aria-label="Emoji">
                    <svg viewBox="0 0 24 24" width="26" height="26" className="fill-current"><path d="M9.153 11.603c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962zm-3.204 1.362c-.026-.307-.131 5.218 6.063 5.551 6.066-.25 6.066-5.551 6.066-5.551-6.078 1.416-12.13 0-12.13 0zm11.362 1.108s-.67 1.96-5.05 1.96c-3.506 0-5.39-1.165-5.608-1.96 0 0 5.912 1.055 10.658 0zM11.804 1.011C5.609 1.011.978 6.033.978 12.228s4.826 10.761 11.021 10.761S23.02 18.423 23.02 12.228c.001-6.195-5.021-11.217-11.216-11.217zM12 21.354c-5.273 0-9.381-3.886-9.381-9.159s3.942-9.548 9.215-9.548 9.548 4.275 9.548 9.548c-.001 5.272-4.109 9.159-9.382 9.159zm3.108-9.751c.795 0 1.439-.879 1.439-1.962s-.644-1.962-1.439-1.962-1.439.879-1.439 1.962.644 1.962 1.439 1.962z"></path></svg>
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} className="hover:text-[#111b21] dark:hover:text-[#d1d7db] transition-colors" aria-label="Attach">
                    <svg viewBox="0 0 24 24" width="26" height="26" className="fill-current"><path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V4.35c0-2.78-2.257-5.036-5.036-5.036s-5.036 2.256-5.036 5.036v7.061c0 2.226 1.81 4.036 4.036 4.036 2.226 0 4.036-1.81 4.036-4.036v-6.31h-1.614v6.31c0 1.336-1.087 2.422-2.422 2.422-1.336 0-2.422-1.086-2.422-2.422V4.35c0-1.89 1.531-3.422 3.422-3.422 1.89 0 3.422 1.532 3.422 3.422v7.061c0 1.112-.904 2.016-2.016 2.016s-2.016-.904-2.016-2.016v-6.31H7.264v6.31c0 2.613 2.122 4.735 4.735 4.735z"></path></svg>
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,.pdf,.doc,.docx" />
                </div>
                
                {/* Text Input / Recording Indicator */}
                <div className="flex-1">
                  {isRecording ? (
                    <div className="w-full h-10 bg-white dark:bg-[#2a3942] rounded-lg px-4 flex items-center gap-3 text-red-500 animate-pulse">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                      <span className="font-medium text-[15px]">Recording... {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
                    </div>
                  ) : (
                    <input 
                      type="text" 
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a message" 
                      className="w-full h-10 bg-white dark:bg-[#2a3942] text-[15px] text-[#111b21] dark:text-[#e9edef] rounded-lg px-4 py-2 focus:outline-none placeholder-[#667781] dark:placeholder-[#8696a0]"
                    />
                  )}
                </div>
                
                {/* Right Icon: Mic / Send */}
                <button 
                  onClick={inputValue.trim() ? handleSendMessage : (isRecording ? stopRecording : startRecording)}
                  className="text-[#54656f] dark:text-[#8696a0] hover:text-[#111b21] dark:hover:text-[#d1d7db] shrink-0 transition-colors" 
                  aria-label={inputValue.trim() ? "Send" : (isRecording ? "Stop Recording" : "Voice Message")}
                >
                  {inputValue.trim() ? (
                    <svg viewBox="0 0 24 24" width="26" height="26" className="fill-current text-[#00a884]"><path d="M1.101 21.757L23.8 12.028 1.101 2.3l.011 7.912 13.623 1.816-13.623 1.817-.011 7.912z"></path></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="26" height="26" className={`fill-current ${isRecording ? 'text-red-500' : ''}`}><path d="M11.999 14.942c2.001 0 3.531-1.53 3.531-3.531V4.35c0-2.78-2.257-5.036-5.036-5.036s-5.036 2.256-5.036 5.036v7.061c0 2.226 1.81 4.036 4.036 4.036 2.226 0 4.036-1.81 4.036-4.036v-6.31h-1.614v6.31c0 1.336-1.087 2.422-2.422 2.422-1.336 0-2.422-1.086-2.422-2.422V4.35c0-1.89 1.531-3.422 3.422-3.422 1.89 0 3.422 1.532 3.422 3.422v7.061c0 1.112-.904 2.016-2.016 2.016s-2.016-.904-2.016-2.016v-6.31H7.264v6.31c0 2.613 2.122 4.735 4.735 4.735z" opacity={isRecording ? "0" : "0.4"} transform="scale(0.8) translate(3,3)" /><path d="M11.995 18.061c3.045 0 5.541-2.43 5.541-5.419v-7.225C17.536 2.429 15.05 0 11.995 0 8.94 0 6.454 2.429 6.454 5.417v7.225c0 2.99 2.486 5.419 5.541 5.419zm-3.83-12.644c0-2.129 1.701-3.83 3.83-3.83 2.13 0 3.83 1.701 3.83 3.83v7.225c0 2.13-1.7 3.83-3.83 3.83-2.129 0-3.83-1.7-3.83-3.83v-7.225zm8.567 5.761h1.761c-.046 4.542-3.666 8.358-8.243 8.878v3.479H8.502v-3.479c-4.577-.52-8.197-4.336-8.243-8.878h1.762c.046 3.619 3.003 6.643 6.632 7.152v.005h3.398v-.005c3.629-.509 6.586-3.533 6.632-7.152z"></path></svg>
                  )}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
              <h1 className="text-[32px] font-light text-[#41525d] dark:text-[#d1d7db] mb-4">SmartChatt Web</h1>
              <p className="text-[14px] text-[#667781] dark:text-[#8696a0] max-w-[460px]">
                Select a contact from the sidebar to start a private conversation.
              </p>
            </div>
          )}
        </main>
      </div>

      {/* --- WebRTC Call Overlays --- */}
      {/* Incoming Call Modal */}
      {callState === "receiving" && callerData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#202c33] p-8 rounded-2xl flex flex-col items-center gap-6 shadow-2xl animate-bounce">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-600 flex items-center justify-center">
              {callerData.callerProfilePic ? (
                <img src={`${API_URL}${callerData.callerProfilePic}`} className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-4xl font-bold">{callerData.callerName.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="text-center">
              <h2 className="text-[#e9edef] text-xl font-medium mb-1">{callerData.callerName}</h2>
              <p className="text-[#8696a0] text-sm">Incoming {callerData.callType} call...</p>
            </div>
            <div className="flex gap-6 mt-4">
              <button onClick={rejectCall} className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors shadow-lg">
                <svg viewBox="0 0 24 24" width="28" height="28" className="fill-current transform rotate-[135deg]"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.03 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"></path></svg>
              </button>
              <button onClick={acceptCall} className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center text-white hover:bg-green-600 transition-colors shadow-lg animate-pulse">
                <svg viewBox="0 0 24 24" width="28" height="28" className="fill-current"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.03 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"></path></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call UI */}
      {(callState === "calling" || callState === "connected") && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
          {/* Main Video/Audio */}
          {callType === "video" ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="w-32 h-32 rounded-full overflow-hidden bg-gray-700 animate-pulse flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="60" height="60" className="text-gray-400 fill-current"><path d="M12 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm9 11a1 1 0 0 1-2 0v-2a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v2a1 1 0 0 1-2 0v-2a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v2z"></path></svg>
              </div>
              <h2 className="text-white text-2xl font-medium">{callerData ? callerData.callerName : selectedContact?.name || selectedContact?.username}</h2>
              <p className="text-gray-400 text-lg">{callState === "calling" ? "Calling..." : "Call Connected"}</p>
            </div>
          )}

          {/* Local PiP Video */}
          {callType === "video" && (
            <div className="absolute top-8 right-8 w-48 h-64 bg-gray-800 rounded-lg overflow-hidden border-2 border-gray-600 shadow-2xl">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
          )}

          {/* Controls Container */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-[#202c33]/80 backdrop-blur px-8 py-4 rounded-full">
            <button className="w-12 h-12 bg-gray-600 hover:bg-gray-500 rounded-full flex items-center justify-center text-white transition-colors" title="Mute/Unmute">
              <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"></path></svg>
            </button>
            <button onClick={endCall} className="w-14 h-14 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white transition-colors" title="End Call">
              <svg viewBox="0 0 24 24" width="28" height="28" className="fill-current transform rotate-[135deg]"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.03 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"></path></svg>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
