import API_ENDPOINTS from '../api/config';

export async function playTts(text: string, token?: string): Promise<void> {
  const headers: Record<string, string> = {};

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API_ENDPOINTS.TTS_SYNTHESIZE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Errore durante la sintesi vocale');
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);

  try {
    const audio = new Audio(audioUrl);
    await audio.play();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
  }
}
