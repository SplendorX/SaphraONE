"use client";

import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

async function jpegUnder500kb(source: HTMLVideoElement | HTMLImageElement) {
  const width = "videoWidth" in source ? source.videoWidth : source.naturalWidth;
  const height = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
  if (!width || !height) throw new Error("Couldn't read the photo.");
  const canvas = document.createElement("canvas");
  const max = 720;
  const scale = Math.min(1, max / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't process the photo.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let quality = 0.85;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 500_000 && quality > 0.4) {
    quality -= 0.1;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  return data;
}

export function SelfieCapture({ onCapture }: { onCapture: (jpegDataUrl: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current: MediaStream | null = null;
    void navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then((next) => {
        current = next;
        setStream(next);
        if (videoRef.current) videoRef.current.srcObject = next;
      })
      .catch(() => setError("Camera permission was denied. You can upload a photo instead."));
    return () => {
      current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    try {
      onCapture(await jpegUnder500kb(video));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't take the photo.");
    } finally {
      setBusy(false);
    }
  }

  async function fromFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const url = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("That file couldn't be opened."));
        image.src = url;
      });
      onCapture(await jpegUnder500kb(image));
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't read that photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[240px] overflow-hidden rounded-3xl bg-muted">
        <video autoPlay className="h-full w-full object-cover" muted playsInline ref={videoRef} />
        <div className="pointer-events-none absolute inset-8 rounded-[50%] border-2 border-white/80" />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button disabled={busy || !stream} onClick={() => void capture()} type="button">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          Take selfie
        </Button>
        <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <ImagePlus className="h-4 w-4" />
          Upload a photo
          <input
            accept="image/jpeg,image/png"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void fromFile(file);
            }}
            type="file"
          />
        </label>
      </div>
    </div>
  );
}
