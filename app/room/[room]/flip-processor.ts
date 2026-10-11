import type { Track, TrackProcessor, VideoProcessorOptions } from "livekit-client";

/**
 * Зеркально отражает исходящее видео по горизонтали (как в зеркале).
 * Используется для передней камеры телефона: отражённый кадр видят и вы, и остальные участники.
 */
export class FlipProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  name = "meetspace-mirror";
  processedTrack?: MediaStreamTrack;

  private video?: HTMLVideoElement;
  private running = false;
  private raf = 0;
  private timer = 0;

  async init(opts: VideoProcessorOptions) {
    await this.start(opts.track);
  }

  async restart(opts: VideoProcessorOptions) {
    this.stop();
    await this.start(opts.track);
  }

  async destroy() {
    this.stop();
  }

  private async start(track: MediaStreamTrack) {
    const video = document.createElement("video");
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    // В DOM, но невидимо: в таком виде кадры гарантированно декодируются на всех мобильных браузерах.
    video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1";
    video.srcObject = new MediaStream([track]);
    document.body.appendChild(video);
    await video.play().catch(() => {});
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        video.addEventListener("loadeddata", () => resolve(), { once: true });
        window.setTimeout(resolve, 2000);
      });
    }

    const settings = track.getSettings();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || settings.width || 640;
    canvas.height = video.videoHeight || settings.height || 360;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("canvas недоступен");
    const fps = Math.max(10, Math.min(60, Math.round(settings.frameRate || 30)));

    const frame = () => {
      if (video.videoWidth && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
    frame();

    this.processedTrack = canvas.captureStream(fps).getVideoTracks()[0];
    this.video = video;
    this.running = true;

    const interval = 1000 / fps;
    let last = 0;
    const loop = (t: number) => {
      if (!this.running) return;
      if (t - last >= interval * 0.85) {
        last = t;
        frame();
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    // Когда вкладка в фоне, requestAnimationFrame замирает — страхуемся таймером.
    this.timer = window.setInterval(() => {
      if (this.running && document.hidden) frame();
    }, interval);
  }

  private stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.timer);
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
    }
    this.video = undefined;
  }
}
