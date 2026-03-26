import { useState, useEffect } from 'react';
import { Mic, Radio } from 'lucide-react';
import { AvatarDisplay } from './AvatarDisplay';
import { BadgeReader } from './BadgeReader';
import { useAuth } from '../../AuthContext';
import { playTts } from '../../ttsClient';

type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

export function OperatorInterface() {
  const { 
    isLoggedIn, 
    accessToken, 
    user, 
    machine, 
    login, 
    logout 
  } = useAuth();
  
  const [avatarState, setAvatarState] = useState<AvatarState>('idle');
  const [transcript, setTranscript] = useState('');
  const [wakeWordActive, setWakeWordActive] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(null);
  const [questionInput, setQuestionInput] = useState('');
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL;
  
  useEffect(() => {
    if (!isLoggedIn || !machine || !user || !accessToken) return;

    const pollMachineStatus = async () => {
      if (!isLoggedIn || !machine || !user || !accessToken) return;
      try {
        const response = await fetch(`${API_URL}/machines/${machine.id}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const machineData = await response.json();
          if (!machineData.in_uso) {
            setLogoutMessage('Macchina liberata dall\'amministratore');
            await handleLogout();
          } else if (machineData.operatore_attuale_id && machineData.operatore_attuale_id !== user.id) {
            setLogoutMessage(`Machine operator mismatch: expected ${user.id}, got ${machineData.operatore_attuale_id}`);
            await handleLogout();
          } else if (!machineData.operatore_attuale_id && machineData.in_uso) {
            setLogoutMessage('Machine inconsistency: in_uso=true but operatore_attuale_id=null');
            await handleLogout();
          }
        } else if (response.status === 401) {
          console.error('Token expired during polling');
        } else {
          console.error(`Polling failed with status: ${response.status}`);
        }
      } catch (error) {
        console.error('Error polling machine status:', error);
      }
    };

    const pollingInterval = setInterval(pollMachineStatus, 10000);
    pollMachineStatus();

    return () => clearInterval(pollingInterval);
  }, [isLoggedIn, machine, user, accessToken, logout, API_URL]);

  const handleBadgeLogin = async (badgeId: string, machineId: number) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/badge-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ badge_id: badgeId, machine_id: machineId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Errore durante il login');
      }
      const data = await response.json();
      login(
        data.access_token,
        data.refresh_token,
        data.user,
        data.machine,
        data.expires_in
      );
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsLogin = async (username: string, password: string, machineId: number) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/credentials-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, machine_id: machineId }),
      });

      if (!response.ok) {
        throw new Error('Credenziali non valide');
      }
      const data = await response.json();
      login(
        data.access_token,
        data.refresh_token,
        data.user,
        data.machine,
        data.expires_in
      );
    } catch (error) {
      console.error('Login error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLogoutMessage(null);
    setAvatarState('idle');
    setTranscript('');
    setQuestionInput('');
    setCurrentTranscription('');
    setShowFollowUp(false);
    setIsTyping(false);
    setShowSubtitles(false);
    setWakeWordActive(true);
    await logout();
  };

  const handleQuestionSubmit = async () => {
    if (questionInput.trim() && user && machine) {
      const userQuestion = questionInput;
      setQuestionInput('');
      setAvatarState('thinking');
      
      try {
        // Chiama il backend per ottenere la risposta
        const response = await fetch(`${API_URL}/api/interactions/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            machine_id: machine.id,
            user_id: user.id,
            question: userQuestion,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Errore nel processamento della domanda');
        }

        const data = await response.json();
        handleTTS();
        setTimeout(() => {
          setAvatarState('speaking');
          startTypingEffect(data.response);
        }, 1500);
      } catch (error) {
        console.error('Error asking question:', error);
        setAvatarState('idle');
        const errorMsg = error instanceof Error ? error.message : 'Errore sconosciuto';
        alert(`Errore: ${errorMsg}`);
      }
    }
  };

    const handleTTS = async () => {
    if (!isLoggedIn) {
      return;
    }
    try {
      await playTts(currentTranscription, accessToken ?? undefined);
    } catch (error) {
      console.error('TTS test error:', error);
      alert(error instanceof Error ? error.message : 'Errore durante il test TTS');
    }
  };

  const handleFollowUpResponse = (resolved: boolean) => {
    console.log(`Problema risolto: ${resolved}`);
    setShowFollowUp(false);
    setCurrentTranscription('');
  };

  const startTypingEffect = (fullText: string) => {
    setCurrentTranscription('');
    setIsTyping(true);
    setShowSubtitles(true);
    
    let index = 0;
    
    const typeNextChar = () => {
      if (index < fullText.length) {
        setCurrentTranscription(fullText.substring(0, index + 1));
        index++;
        setTimeout(typeNextChar, 50);
      } else {
        setIsTyping(false);
        setAvatarState('idle');
        setShowSubtitles(false);
        setShowFollowUp(true);
      }
    };
    
    typeNextChar();
  };

  /*
  const simulateWakeWord = () => {
    if (avatarState === 'idle' && isLoggedIn) {
      setAvatarState('listening');
      setShowSubtitles(true);
      setTranscript('In ascolto...');
      
      setTimeout(() => {
        setTranscript('Come cambio l\'olio?');
        setAvatarState('thinking');
        
        setTimeout(() => {
          const response = 'Per cambiare l\'olio della Pressa A7: \n1. Spegnere la macchina. \n2. Attendere il raffreddamento. \n3. Posizionare un contenitore sotto lo scarico';
          setTranscript('');
          setAvatarState('speaking');
          
          // Start typing effect during speaking state
          startTypingEffect(response);
          
          // After typing is complete, return to idle and show follow-up
          // The follow-up will be shown by startTypingEffect when typing completes
        }, 2000);
      }, 3000);
    }
  };
  */
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white relative overflow-hidden">
      {/* Logout notification */}
      {logoutMessage && (
        <div className="fixed top-4 left-4 right-4 z-50 bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-100 backdrop-blur-md">
          <p className="font-semibold">{logoutMessage}</p>
          <p className="text-sm text-red-200 mt-1">Sei stato disconnesso dalla macchina</p>
        </div>
      )}

      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }}></div>
      </div>

      {/* Header with machine info */}
      <div className="relative z-10 p-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-blue-400">DITTO</span> Assistente
          </h1>
          {machine && (
            <p className="text-sm text-gray-400 mt-1">
              Postazione: {machine.nome} - {machine.id_postazione}
            </p>
          )}
        </div>
        
        <div className="flex items-center gap-4">
          {isLoggedIn && user && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm text-gray-400">Operatore</p>
                <p className="font-semibold">{user.nome}</p>
                <p className="text-xs text-gray-500">{user.livello_esperienza} - {user.turno}</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={isTyping || avatarState === 'speaking'}
                className={`px-4 py-2 rounded-lg transition-colors border border-red-500/50 ${isTyping || avatarState === 'speaking' ? 'bg-red-500/10 text-red-300 cursor-not-allowed' : 'bg-red-500/20 hover:bg-red-500/30 text-white'}`}
              >
                Logout
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Radio className={`h-5 w-5 ${wakeWordActive ? 'text-green-400 animate-pulse' : 'text-gray-500'}`} />
            <span className="text-sm text-gray-400">
              {wakeWordActive ? 'Wake word attivo' : 'Disattivato'}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      {!isLoggedIn ? (
        <BadgeReader 
          onBadgeDetected={handleBadgeLogin}
          onCredentialsLogin={handleCredentialsLogin}
        />
      ) : (
        <div className="relative z-10 flex flex-col items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-4 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400">Accesso in corso...</p>
            </div>
          ) : (
            <>
              {/* Avatar Display */}
              <AvatarDisplay state={avatarState} />

              {/* Status indicator */}
              <div className="mt-8 text-center">
                <div className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20">
                  {avatarState === 'idle' && (
                    <>
                      <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                      <span>In attesa - Di' "Ehi Ditto" per iniziare</span>
                    </>
                  )}
                  {avatarState === 'listening' && (
                    <>
                      <Mic className="h-5 w-5 text-blue-400 animate-pulse" />
                      <span>In ascolto...</span>
                    </>
                  )}
                  {avatarState === 'thinking' && (
                    <>
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                      <span>Elaborazione in corso...</span>
                    </>
                  )}
                  {avatarState === 'speaking' && (
                    <>
                      <div className="w-3 h-3 bg-purple-400 rounded-full animate-pulse"></div>
                      <span>Risposta in corso...</span>
                    </>
                  )}
                </div>
              </div>

              {/* Text input for questions */}
              <div className="mt-8 w-full max-w-md mx-auto px-6">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={questionInput}
                    onChange={(e) => {
                      setQuestionInput(e.target.value);
                      // Reset transcription when user starts typing a new question
                      if (currentTranscription && !isTyping) {
                        setCurrentTranscription('');
                        setShowFollowUp(false);
                      }
                    }}
                    placeholder="Scrivi la tua domanda..."
                    disabled={isTyping}
                    className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
                    onKeyPress={(e) => e.key === 'Enter' && !isTyping && handleQuestionSubmit()}
                  />
                  <button
                    onClick={handleQuestionSubmit}
                    disabled={isTyping || !questionInput.trim()}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-500 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    Invia
                  </button>
                </div>
              </div>

              {/* Transcription display */}
              {currentTranscription && (
                <div className="mt-6 w-full max-w-2xl mx-auto px-6">
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-300 mb-2">Risposta Assistente</h3>
                    <div className="text-sm text-gray-200 whitespace-pre-line">
                      {currentTranscription}
                      {isTyping && <span className="animate-pulse">|</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* Follow-up question */}
              {showFollowUp && (
                <div className="mt-6 w-full max-w-md mx-auto px-6">
                  <div className="bg-white/10 border border-white/20 rounded-lg p-4 text-center">
                    <p className="text-lg font-semibold mb-4">Hai risolto il problema?</p>
                    <div className="flex gap-4 justify-center">
                      <button
                        onClick={() => handleFollowUpResponse(true)}
                        className="px-6 py-2 bg-green-500 hover:bg-green-600 rounded-lg transition-colors"
                      >
                        Sì
                      </button>
                      <button
                        onClick={() => handleFollowUpResponse(false)}
                        className="px-6 py-2 bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick actions */}
              <div className="mt-12 grid grid-cols-3 gap-4 max-w-2xl mx-auto px-6">
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Emergenza</span>
                  <span className="block font-semibold">🚨 Alert</span>
                </button>
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Manutenzione</span>
                  <span className="block font-semibold">🔧 Chiama</span>
                </button>
                <button className="p-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors">
                  <span className="block text-sm text-gray-400 mb-1">Supporto</span>
                  <span className="block font-semibold">❓ Aiuto</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}