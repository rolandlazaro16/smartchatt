"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { io, Socket } from "socket.io-client";

interface Message {
  _id?: string;
  text: string;
  sender: string;
  createdAt?: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://smartchatt.onrender.com';

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Fetch initial message history from the backend REST API
    fetch(`${API_URL}/api/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMessages(data);
        }
      })
      .catch((err) => console.error("Failed to fetch messages:", err));

    // 2. Connect to Socket.IO for real-time updates
    socketRef.current = io(API_URL);

    socketRef.current.on("receive_message", (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim() || !socketRef.current) return;

    // Emit the message to the backend via WebSocket
    socketRef.current.emit("send_message", {
      text: inputValue,
      sender: "User",
    });

    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a]">
      {/* Sidebar */}
      <aside className="w-80 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111] flex flex-col hidden md:flex">
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-600">
            SmartChatt
          </h1>
          <button className="p-2 bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Static Chat History Items for design */}
          <div className="p-3 rounded-xl bg-gray-100 dark:bg-gray-800 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">Getting started with Next.js</p>
            <p className="text-xs text-gray-500 mt-1">Today, 2:30 PM</p>
          </div>
          <div className="p-3 rounded-xl cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-300 truncate">How to build a chat interface</p>
            <p className="text-xs text-gray-500 mt-1">Yesterday</p>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative">
        <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10">
          <h2 className="font-semibold text-gray-800 dark:text-gray-200">Current Chat</h2>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 pb-32">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 mt-10">
              No messages yet. Start typing below!
            </div>
          ) : (
            messages.map((msg, idx) => {
              const isUser = msg.sender === "User";
              return (
                <div key={msg._id || idx} className={`flex gap-4 ${isUser ? "flex-row-reverse" : ""}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isUser ? "bg-gray-200 dark:bg-gray-700" : "bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg"}`}>
                    {isUser ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 dark:text-gray-400"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                    )}
                  </div>
                  <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? "items-end" : ""}`}>
                    <span className={`text-sm font-medium text-gray-500 ${isUser ? "mr-1" : "ml-1"}`}>{msg.sender}</span>
                    <div className={`${isUser ? "bg-blue-600 text-white rounded-tr-none" : "bg-white dark:bg-[#111] text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-800 rounded-tl-none"} p-4 rounded-2xl shadow-sm leading-relaxed`}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent dark:from-[#0a0a0a] dark:via-[#0a0a0a]">
          <div className="max-w-4xl mx-auto relative flex items-center">
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message SmartChatt..." 
              className="w-full bg-white dark:bg-[#111] border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 rounded-full pl-6 pr-14 py-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-shadow"
            />
            <button 
              onClick={handleSendMessage}
              className="absolute right-2 p-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
              disabled={!inputValue.trim()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
          <p className="text-center text-xs text-gray-400 mt-3 font-medium">SmartChatt can make mistakes. Consider verifying important information.</p>
        </div>
      </main>
    </div>
  );
}
