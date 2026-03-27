import API_ENDPOINTS from '../api/config';

export type TtsPlayback = {
  durationMs: number;
  finished: Promise<void>;
};

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

export async function playTts(text: string, token?: string): Promise<TtsPlayback> {
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

  const audioBlob = await response.blob();
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
    const durationMs = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration * 1000
      : 0;

    return { durationMs, finished };
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
  }
}
