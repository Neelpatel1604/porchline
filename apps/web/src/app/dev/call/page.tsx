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
  const [live, setLive] = useState(false);
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
    socket.onopen = () => {
      setLive(true);
      setStatus("Connected. Speak after the greeting.");
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        setStatus(event.data);
        return;
      }
      playPcm(new Int16Array(event.data));
    };
    socket.onclose = () => {
      setLive(false);
      setStatus("Call ended");
    };

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
    setLive(false);
    setStatus("Call ended");
  }

  return (
    <main className="stage-shell min-h-screen px-4 py-6 text-white md:px-8 md:py-8">
      <header className="mx-auto flex max-w-3xl flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-6">
        <div>
          <p className="font-display text-5xl tracking-tight md:text-6xl">Porchline</p>
          <p className="mt-2 max-w-xl text-base text-white/65">
            Dev mic — local Higgs path for rehearsal. Real owners still call through Twilio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              live ? "bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-300/40" : "bg-white/10 text-white/70"
            }`}
          >
            {live ? <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" /> : null}
            {live ? "Mic live" : "Idle"}
          </div>
          <a className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:bg-white/5" href="/">
            Operator desk
          </a>
        </div>
      </header>

      <section className="mx-auto mt-6 max-w-3xl">
        <article className="rounded-3xl bg-[#171a22]/90 p-6 ring-1 ring-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.35)]">
          <h1 className="font-display text-3xl tracking-tight">Mic call</h1>
          <p className="mt-3 text-sm text-white/55">
            This page only exists for local testing. Watch the live transcript on the operator desk while you speak.
          </p>

          <div className="mt-6 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-white/80 ring-1 ring-white/10">
            {status}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-semibold text-[#1a1208] hover:bg-amber-300 disabled:opacity-40"
              disabled={live}
              onClick={() => void start()}
              type="button"
            >
              Start mic
            </button>
            <button
              className="rounded-full border border-white/20 px-5 py-2.5 text-sm text-white/85 hover:bg-white/5 disabled:opacity-40"
              disabled={!live}
              onClick={stop}
              type="button"
            >
              Hang up
            </button>
          </div>
        </article>
      </section>
    </main>
  );
}
