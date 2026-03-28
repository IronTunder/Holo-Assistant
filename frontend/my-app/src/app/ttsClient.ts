import API_ENDPOINTS from '../api/config';

type TtsSynthesisApiResponse = {
  audio_base64: string;
  mime_type: string;
  duration_ms: number;
  words: string[];
  wtimes: number[];
  wdurations: number[];
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
};

export type TtsSpeechPayload = {
  audio: ArrayBuffer;
  mimeType: string;
  durationMs: number;
  words: string[];
  wtimes: number[];
  wdurations: number[];
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
};

export type TtsPlayback = {
  durationMs: number;
  finished: Promise<void>;
};

function base64ToArrayBuffer(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };

    const onCanPlay = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Impossibile leggere i metadati dell\'audio TTS'));
    };

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('error', onError);
    };

    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('error', onError);
  });
}

export async function synthesizeTts(text: string, token?: string): Promise<TtsSpeechPayload> {
  const headers: Record<string, string> = {};
  const browserLanguage = navigator.language || 'it-IT';

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API_ENDPOINTS.TTS_SYNTHESIZE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Browser-Language': browserLanguage,
      ...headers,
    },
    body: JSON.stringify({ text, language: browserLanguage }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Errore durante la sintesi vocale');
  }

  const payload = (await response.json()) as TtsSynthesisApiResponse;

  return {
    audio: base64ToArrayBuffer(payload.audio_base64),
    mimeType: payload.mime_type,
    durationMs: payload.duration_ms,
    words: payload.words,
    wtimes: payload.wtimes,
    wdurations: payload.wdurations,
    visemes: payload.visemes,
    vtimes: payload.vtimes,
    vdurations: payload.vdurations,
  };
}

export async function playTtsAudio(payload: TtsSpeechPayload): Promise<TtsPlayback> {
  const audioBlob = new Blob([payload.audio], { type: payload.mimeType });
  const audioUrl = URL.createObjectURL(audioBlob);

  try {
    const audio = new Audio(audioUrl);
    const finished = new Promise<void>((resolve, reject) => {
      const onEnded = () => {
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error('Errore durante la riproduzione audio TTS'));
      };

      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };

      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
    });

    await waitForAudioMetadata(audio);
    await audio.play();

    return {
      durationMs:
        payload.durationMs ||
        (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0),
      finished,
    };
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
  }
}
