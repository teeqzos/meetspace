import type { Track, TrackProcessor, VideoProcessorOptions } from "livekit-client";

/**
 * Разворачивает исходящее видео по горизонтали.
 * Нужен только тем, у кого сам телефон отдаёт зеркальную картинку фронтальной камеры
 * (в приложении картинка нигде не зеркалится). По умолчанию выключено.
 */
export class FlipProcessor implements TrackProcessor<Track.Kind.Video, VideoProcessorOptions> {
  name = "meetspace-unmirror";
  processedTrack?: MediaStreamTrack;

  private video?: HTMLVideoElement;
  private running = false;

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
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    await video.play().catch(() => {});

    const settings = track.getSettings();
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || settings.width || 640;
    canvas.height = video.videoHeight || settings.height || 360;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas недоступен");

    const stream = canvas.captureStream(Math.round(settings.frameRate || 30));
    this.processedTrack = stream.getVideoTracks()[0];
    this.video = video;
    this.running = true;

    const schedule = () => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw);
      else requestAnimationFrame(draw);
    };
    const draw = () => {
      if (!this.running) return;
      if (video.videoWidth && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      schedule();
    };
    schedule();
  }

  private stop() {
    this.running = false;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    if (this.video) this.video.srcObject = null;
    this.video = undefined;
  }
}
