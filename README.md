# Home Camera

Turn one phone into a live home camera, and watch it from another phone — anywhere with internet, with two-way audio and clip recording.

## How it works

- The **camera phone** opens `camera.html` in its browser, streams its video/mic.
- The **viewer phone** opens `viewer.html`, connects to the camera directly (peer-to-peer video), and can talk back and record clips.
- A small server (this project) only helps the two phones find each other — the actual video never passes through it.

## Deploy (GitHub → Render, same as your other projects)

### 1. Upload to GitHub
1. Create a new GitHub repository (e.g. `home-camera-app`).
2. Upload every file in this folder, keeping the folder structure — `public/` must stay a subfolder, not flattened.

### 2. Deploy on Render
1. Go to Render → New → Web Service → connect your GitHub repo.
2. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
3. Under **Environment**, add:
   - `ROOM_PIN` = a PIN only you know (e.g. `482913`)
4. Deploy. Render gives you a URL like `home-camera-app.onrender.com`.

### 3. Use it
1. On the **iPhone 6**: open `https://home-camera-app.onrender.com/camera.html` in Safari, enter the PIN, tap **Start Camera**. Allow camera/mic access.
   - Go to Settings → Display & Brightness → Auto-Lock → **Never**, and keep it plugged into power.
2. On your **other phone**: open `https://home-camera-app.onrender.com/viewer.html`, enter the same PIN, tap **Connect**.
3. You should see live video within a few seconds. Tap the mic button to talk, or Record to save a clip (downloads to your phone).

## Notes

- Free Render services sleep after inactivity — the same UptimeRobot trick you used on your other apps will keep this one awake too.
- Video/audio travels directly between the two phones (WebRTC), so it stays fast even though the server is only used to connect them. A free public TURN relay is included as a fallback for networks that block direct connections.
- Only one camera and one viewer can be connected at a time in this version — perfect for a personal 2-phone setup.
