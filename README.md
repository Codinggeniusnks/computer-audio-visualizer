# Purple Voxel Pulse

Purple Voxel Pulse is an offline WebGL2 live wallpaper inspired by radial voxel music visualizers. It reacts to audio already playing on Windows; it does not contain or play bundled music.

## Install in Lively Wallpaper

1. Install and open Lively Wallpaper.
2. Drag `PurpleVoxelAudioWallpaper-Lively.zip` into the Lively window, or choose **Add Wallpaper → Choose a file**.
3. Select **Purple Voxel Pulse** in the library.
4. Right-click the wallpaper and choose **Customise** to adjust sensitivity, motion, quality, frame rate, bloom, and colors.

Lively must be allowed to use the active Windows playback device for audio visualizers. The package enables its required `--audio` integration automatically.

## Install in Wallpaper Engine

1. Extract `PurpleVoxelAudioWallpaper-WallpaperEngine.zip` to its own folder.
2. Open Wallpaper Engine and select **Create Wallpaper**.
3. Drag the extracted `index.html` into the editor and choose the **Web** wallpaper type if prompted.
4. Save and apply the wallpaper. Wallpaper Engine should detect the audio listener; the included `project.json` also declares audio processing support.
5. Adjust the wallpaper properties from the Installed tab.

## Browser preview

Open `index.html` in a modern browser. The preview panel uses a generated beat by default. Choose a local audio file to test the visualizer with real music. The selected file stays on the computer and is never uploaded.

A normal browser cannot capture general Windows system audio. Install the wallpaper in Lively or Wallpaper Engine for live reaction to Spotify, YouTube, media players, games, and other applications.

## Controls

- **Audio sensitivity:** Raises or lowers the incoming spectrum before animation.
- **Motion intensity:** Changes voxel height, wave strength, and camera pulse.
- **Render quality:** Low uses 3,840 columns, Balanced uses 8,192, and High uses 11,520.
- **Frame rate:** 30 FPS reduces power use; 60 FPS is smoother.
- **Bloom glow:** Adds the bright magenta-white halo. Disable it first on slow GPUs.
- **Idle motion:** Keeps the rings moving gently after 1.5 seconds of silence.
- **Voxel/background colors:** Recolor the procedural scene without external assets.

## Troubleshooting

- **No movement:** Confirm music is playing through the default Windows playback device and the wallpaper host is not muted. Increase sensitivity to 1.8–2.2 for quiet sources.
- **Low frame rate:** Select Low quality, disable bloom, or choose 30 FPS. The renderer also reduces its internal resolution automatically when sustained render time is too high.
- **Black screen:** Update the graphics driver and use Lively's WebView2/Chromium renderer. WebGL2 is required.
- **Wallpaper pauses:** Both hosts may pause wallpapers while a full-screen application is active or while the computer is on battery. Change the host's performance rules if desired.

## Privacy and assets

The wallpaper is self-contained and makes no network requests. It includes no Instagram video, audio, frames, logos, or other third-party media. All visible art is generated procedurally at runtime.
