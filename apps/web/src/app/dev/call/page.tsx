"use client";

import { useRef, useState } from "react";

const TARGET_RATE = 24000;

function downsample(input: Float32Array, sampleRate: number): Int16Array {
  const ratio = sampleRate / TARGET_RATE;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[Math.floor(index * ratio)] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export default function DevCallPage() {
  const [status, setStatus] = useState("Idle");
  const socketRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const nextPlayRef = useRef(0);

  function playPcm(pcm: Int16Array) {
    const context = audioRef.current;
    if (!context) return;
    const buffer = context.createBuffer(1, pcm.length, TARGET_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < pcm.length; index += 1) channel[index] = pcm[index] / 0x8000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const start = Math.max(context.currentTime, nextPlayRef.current);
    source.start(start);
    nextPlayRef.current = start + buffer.duration;
  }

  async function start() {
    const context = new AudioContext();
    audioRef.current = context;
    nextPlayRef.current = context.currentTime;
    const media = await navigator.mediaDevices.getUserMedia({ audio: true });
    const socket = new WebSocket("ws://localhost:8000/dev/stream?caller=dev-mic");
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;
    socket.onopen = () => setStatus("Connected. Speak after the greeting.");
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        setStatus(event.data);
        return;
      }
      playPcm(new Int16Array(event.data));
    };
    socket.onclose = () => setStatus("Call ended");

    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
    processor.onaudioprocess = (event) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const pcm = downsample(event.inputBuffer.getChannelData(0), context.sampleRate);
      socket.send(pcm.buffer);
    };
  }

  function stop() {
    socketRef.current?.close();
    void audioRef.current?.close();
    setStatus("Call ended");
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <p className="text-xs uppercase tracking-[0.18em] text-brick">Dev only</p>
      <h1 className="mt-2 font-serif text-4xl">Mic call</h1>
      <p className="mt-3 text-sm text-stone-700">
        This talks to Higgs through the local voice service. It is not the shop owner&apos;s path. A real call uses Twilio.
      </p>
      <p className="mt-6 text-sm">{status}</p>
      <div className="mt-6 flex gap-3">
        <button className="rounded-full bg-ink px-4 py-2 text-sm text-paper" onClick={start} type="button">
          Start
        </button>
        <button className="rounded-full border border-ink px-4 py-2 text-sm" onClick={stop} type="button">
          Hang up
        </button>
      </div>
      <p className="mt-8 text-sm">
        <a className="underline" href="/">
          Back to the desk
        </a>
      </p>
    </main>
  );
}
