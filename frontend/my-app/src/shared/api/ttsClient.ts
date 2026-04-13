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

type TtsSynthesisMetadata = Omit<TtsSynthesisApiResponse, 'audio_base64'>;

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

function isMultipartTtsResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.toLowerCase().includes('multipart/form-data');
}

async function parseMultipartTtsResponse(response: Response): Promise<TtsSpeechPayload> {
  const formData = await response.formData();
  const metadataField = formData.get('metadata');
  const audioField = formData.get('audio');

  if (typeof metadataField !== 'string') {
    throw new Error('Metadati TTS mancanti nella risposta multipart');
  }

  if (!(audioField instanceof Blob)) {
    throw new Error('Audio TTS mancante nella risposta multipart');
  }

  const metadata = JSON.parse(metadataField) as TtsSynthesisMetadata;
  const audio = await audioField.arrayBuffer();

  return {
    audio,
    mimeType: metadata.mime_type,
    durationMs: metadata.duration_ms,
    words: metadata.words,
    wtimes: metadata.wtimes,
    wdurations: metadata.wdurations,
    visemes: metadata.visemes,
    vtimes: metadata.vtimes,
    vdurations: metadata.vdurations,
  };
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
      'Accept': 'multipart/form-data, application/json',
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

  if (isMultipartTtsResponse(response)) {
    return parseMultipartTtsResponse(response);
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
  const audio = new Audio(audioUrl);
  const releaseAudioResources = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    window.setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
  };

  try {
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

    void finished.finally(() => {
      releaseAudioResources();
    });

    return {
      durationMs:
        payload.durationMs ||
        (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : 0),
      finished,
    };
  } catch (error) {
    releaseAudioResources();
    throw error;
  }
}
