//Global import
import express from "express";
import dotenv from "dotenv";

// Handle uncaught exceptions (like Redis ECONNRESET) to prevent server crash
process.on('uncaughtException', (err) => {
    if (err.code === 'ECONNRESET') {
        // console.warn('⚠️ Network error caught (ECONNRESET). Preventing server crash.');
        // Silently handle it to not spam the console
    } else {
        console.error('💥 Uncaught Exception:', err);
        // Only exit if it's not a known transient network error
        // process.exit(1);
    }
});
import cookieparser from "cookie-parser";
import cors from "cors";

//Local import 
import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/auth.routes.js";
import messageRoutes from "./routes/message.routes.js";
import aiRoutes from "./routes/ai.routes.js";

import { app,server } from "./lib/socket.js";


import path from "path";

dotenv.config();

const PORT = process.env.PORT || 8080;
const __dirname = path.resolve();




app.use(express.json({ limit: "10mb" }));
app.use(cookieparser());
app.use(
    cors({
        origin: ["http://localhost:5173", "http://localhost:5174"],
        credentials: true,
       
    })
)


// Routes
app.use("/api/auth" , authRoutes);
app.use("/api/messages" , messageRoutes);
app.use("/api/ai", aiRoutes);

if (process.env.NODE_ENV === "production") {
    // We are currently in the 'backend' folder, so we need to go up one level to find 'frontend'
    const frontendDistPath = path.join(__dirname, "..", "frontend", "dist");
    
    app.use(express.static(frontendDistPath));
  
    app.get("*", (req, res) => {
      res.sendFile(path.join(frontendDistPath, "index.html"));
    });
  }

server.listen(PORT , ()=>{
    console.log(`Server is running on port ${PORT}`);
    connectDB();
})