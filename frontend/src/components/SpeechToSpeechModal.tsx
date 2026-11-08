import React, { useState, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  X,
  AlertTriangle,
  Loader2,
  Bot
} from 'lucide-react';
import { uzbekVoiceService } from '../services/uzbekVoiceService';
import { aiDialogService } from '../services/aiDialogService';
import { edgeTtsService } from '../services/edgeTtsService';
import { tacticalAudio } from '../services/audioService';

interface SpeechToSpeechModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpeechActivity?: (level: number) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'robot';
  text: string;
  time: string;
}

export const SpeechToSpeechModal: React.FC<SpeechToSpeechModalProps> = ({
  isOpen,
  onClose,
  onSpeechActivity
}) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'robot',
      text: "Assalomu alaykum! Men QALQON avtonom patrul robotiman. Menga o'zbek tilida savol bering yoki buyruq ayting.",
      time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const speechAnimationRef = useRef<number | null>(null);

  // API kalitlari endi AI & Avtonom bo'limidagi "API kalitlari" kartasida kiritiladi

  // ==========================================================================
  // SPEECH-TO-SPEECH (S2S) PIPELINE
  // ==========================================================================
  const startListening = async () => {
    setErrorMessage(null);
    if (!uzbekVoiceService.hasApiKey()) {
      setErrorMessage("Avval AI & Avtonom bo'limidagi \"API kalitlari\" kartasida UzbekVoice.ai kalitini kiriting.");
      return;
    }

    try {
      tacticalAudio.playClick();
      await uzbekVoiceService.startRecording();
      setIsRecording(true);
    } catch (err) {
      console.error('[S2S] startRecording error:', err);
      setErrorMessage(err instanceof Error ? err.message : "Mikrofonni yoqishda xatolik yuz berdi.");
    }
  };

  const stopAndProcess = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      tacticalAudio.playCommandBeep();
      // 1. Audio Blob olish
      const audioBlob = await uzbekVoiceService.stopRecording();

      // 2. STT (Speech-to-Text) - UzbekVoice.ai API
      const sttResult = await uzbekVoiceService.transcribeAudio(audioBlob);
      const recognizedText = sttResult.text;

      const userMsg: ChatMessage = {
        id: Date.now().toString(),
        sender: 'user',
        text: recognizedText,
        time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, userMsg]);

      // 3. AI Dialog (Miya orqali javob generatsiya qilish)
      const aiResponse = await aiDialogService.respond(recognizedText);
      const robotAnswer = aiResponse.answer;

      const robotMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'robot',
        text: robotAnswer,
        time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, robotMsg]);

      // 4. UzbekVoice.ai Lola TTS orqali audio ijro etish
      setIsProcessing(false);
      speakRobotResponse(robotAnswer, aiResponse.audioUrl);
    } catch (err) {
      console.error('[S2S] Pipeline error:', err);
      setIsProcessing(false);
      setErrorMessage(err instanceof Error ? err.message : "Ovozni aniqlashda xatolik yuz berdi.");
    }
  };

  const speakRobotResponse = (text: string, audioUrl?: string) => {
    setIsSpeaking(true);

    let tick = 0;
    if (speechAnimationRef.current) clearInterval(speechAnimationRef.current);

    speechAnimationRef.current = window.setInterval(() => {
      tick++;
      const level = 0.5 + Math.sin(tick * 0.7) * 0.4 + Math.random() * 0.2;
      onSpeechActivity?.(level);
    }, 50);

    const finish = () => {
      if (speechAnimationRef.current) clearInterval(speechAnimationRef.current);
      onSpeechActivity?.(0);
      setIsSpeaking(false);
    };

    if (audioUrl) {
      const au = new Audio(audioUrl);
      au.onended = finish;
      au.onerror = () => edgeTtsService.speak(text, { voice: 'uz-UZ-SardorNeural' }, undefined, finish);
      au.play().catch(() => edgeTtsService.speak(text, { voice: 'uz-UZ-SardorNeural' }, undefined, finish));
    } else {
      edgeTtsService.speak(text, { voice: 'uz-UZ-SardorNeural', rate: 1.0 }, undefined, finish);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in font-sans">
      <div className="relative w-full max-w-xl bg-tactical-900 border border-tactical-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
        
        {/* Modal Sarlavhasi */}
        <div className="px-5 py-4 border-b border-tactical-800 flex items-center justify-between bg-tactical-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-police-blue/20 border border-police-cyan/40 flex items-center justify-center">
              <Bot className="w-5 h-5 text-police-cyan" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-mono text-sm font-extrabold text-white tracking-wider">
                  OVOZLI MULOQOT (SPEECH-TO-SPEECH)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  uzbekvoice.ai
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400">
                UzbekVoice.ai STT & TTS (o'zbekcha ovoz)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-tactical-800 hover:bg-tactical-700 border border-tactical-600 text-slate-300 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Xabarlar oynasi */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px] max-h-[350px]">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center space-x-1.5 mb-1 px-1">
                <span className="text-[10px] font-mono text-slate-400">
                  {m.sender === 'user' ? 'Siz' : 'Qalqon Robot'}
                </span>
                <span className="text-[9px] font-mono text-slate-500">{m.time}</span>
              </div>
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-xs font-medium leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-police-blue text-white rounded-tr-none'
                    : 'bg-tactical-800 text-slate-100 border border-tactical-700 rounded-tl-none'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center space-x-2 text-police-cyan font-mono text-xs p-2 animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>UzbekVoice.ai orqali nutq aniqlanmoqda va tahlil qilinmoqda...</span>
            </div>
          )}

          {isSpeaking && (
            <div className="flex items-center space-x-2 text-emerald-400 font-mono text-xs p-2">
              <Volume2 className="w-4 h-4 animate-bounce" />
              <span>Qalqon javob bermoqda...</span>
            </div>
          )}
        </div>

        {/* Xatolik xabari */}
        {errorMessage && (
          <div className="mx-4 mb-2 p-2.5 bg-rose-950/60 border border-rose-700/60 rounded-xl text-rose-300 text-xs font-mono flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* Boshqaruv & Mikrofon tugmasi */}
        <div className="p-4 bg-tactical-950/80 border-t border-tactical-800 flex flex-col items-center justify-center space-y-3">
          
          {/* Asosiy Voice Record Tugmasi */}
          <div className="flex items-center space-x-4">
            <button
              onClick={isRecording ? stopAndProcess : startListening}
              disabled={isProcessing || isSpeaking}
              className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-xl disabled:opacity-50 ${
                isRecording
                  ? 'bg-rose-600 text-white animate-pulse ring-8 ring-rose-500/30 scale-110'
                  : 'bg-gradient-to-r from-police-blue to-cyan-600 hover:from-blue-600 hover:to-cyan-500 text-white shadow-police-blue/30'
              }`}
              title={isRecording ? "To'xtatish va yuborish" : "Gapirish uchun bosing"}
            >
              {isRecording ? (
                <MicOff className="w-7 h-7" />
              ) : (
                <Mic className="w-7 h-7" />
              )}
            </button>
          </div>

          <div className="text-center font-mono text-xs">
            {isRecording ? (
              <span className="text-rose-400 font-bold animate-pulse">
                🎙️ Sizni tinglamoqdaman... Tugatish uchun tugmani yana bosing
              </span>
            ) : isProcessing ? (
              <span className="text-police-cyan">
                ⏳ UzbekVoice.ai STT qayta ishlanmoqda...
              </span>
            ) : isSpeaking ? (
              <span className="text-emerald-400">
                🗣️ Robot javob bermoqda...
              </span>
            ) : (
              <span className="text-slate-400">
                {uzbekVoiceService.hasApiKey()
                  ? "Gapirish uchun mikrofon tugmasini bosing"
                  : "Muloqot qilish uchun yuqorida API kalitni kiriting"}
              </span>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
