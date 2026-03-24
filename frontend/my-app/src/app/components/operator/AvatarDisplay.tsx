import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AvatarDisplayProps {
  state: AvatarState;
}

type MouthShape = 'closed' | 'neutral' | 'open' | 'wide' | 'round';

export function AvatarDisplay({ state }: AvatarDisplayProps) {
  const [mouthShape, setMouthShape] = useState<MouthShape>('closed');
  const [eyeExpression, setEyeExpression] = useState<'normal' | 'focused' | 'thinking'>('normal');

  // Simula il lip-sync durante la parlata
  useEffect(() => {
    if (state === 'speaking') {
      const shapes: MouthShape[] = ['open', 'wide', 'neutral', 'round', 'open', 'neutral', 'closed'];
      let index = 0;
      const interval = setInterval(() => {
        setMouthShape(shapes[index % shapes.length]);
        index++;
      }, 150);
      return () => clearInterval(interval);
    } else if (state === 'thinking') {
      setMouthShape('neutral');
      setEyeExpression('thinking');
    } else if (state === 'listening') {
      setMouthShape('neutral');
      setEyeExpression('focused');
    } else {
      setMouthShape('closed');
      setEyeExpression('normal');
    }
  }, [state]);

  const getMouthPath = () => {
    switch (mouthShape) {
      case 'closed':
        return 'M 40 55 Q 50 55 60 55';
      case 'neutral':
        return 'M 40 55 Q 50 57 60 55';
      case 'open':
        return 'M 40 52 Q 50 62 60 52';
      case 'wide':
        return 'M 35 55 Q 50 65 65 55';
      case 'round':
        return 'M 42 52 Q 50 60 58 52 Q 50 58 42 52 Z';
    }
  };

  const getEyeShape = () => {
    switch (eyeExpression) {
      case 'focused':
        return { left: 'M 30 35 Q 35 33 40 35', right: 'M 60 35 Q 65 33 70 35' };
      case 'thinking':
        return { left: 'M 30 35 Q 35 32 40 35', right: 'M 60 32 Q 65 30 70 32' };
      default:
        return { left: 'M 30 35 Q 35 34 40 35', right: 'M 60 35 Q 65 34 70 35' };
    }
  };

  const eyeShape = getEyeShape();

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="relative"
    >
      {/* Glow effect */}
      <div className={`absolute inset-0 rounded-full blur-3xl transition-all duration-500 ${
        state === 'listening' ? 'bg-blue-500/30' :
        state === 'thinking' ? 'bg-yellow-500/30' :
        state === 'speaking' ? 'bg-purple-500/30' :
        'bg-green-500/20'
      }`}></div>

      {/* Avatar container */}
      <div className="relative w-80 h-80 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full border-4 border-white/20 backdrop-blur-sm flex items-center justify-center overflow-hidden">
        {/* Avatar face */}
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {/* Head */}
          <ellipse cx="50" cy="50" rx="35" ry="40" fill="#E8D4C0" />
          
          {/* Eyes */}
          <motion.path
            d={eyeShape.left}
            stroke="#2C3E50"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            animate={{ d: eyeShape.left }}
            transition={{ duration: 0.2 }}
          />
          <motion.path
            d={eyeShape.right}
            stroke="#2C3E50"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            animate={{ d: eyeShape.right }}
            transition={{ duration: 0.2 }}
          />

          {/* Pupils */}
          {eyeExpression !== 'thinking' ? (
            <>
              <circle cx="35" cy="37" r="2.5" fill="#2C3E50" />
              <circle cx="65" cy="37" r="2.5" fill="#2C3E50" />
            </>
          ) : (
            <>
              <circle cx="36" cy="34" r="2.5" fill="#2C3E50" />
              <circle cx="66" cy="32" r="2.5" fill="#2C3E50" />
            </>
          )}

          {/* Eyebrows */}
          <motion.path
            d={state === 'thinking' ? 'M 27 28 Q 32 25 37 27' : 'M 27 30 Q 32 28 37 30'}
            stroke="#8B6F47"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            animate={{ d: state === 'thinking' ? 'M 27 28 Q 32 25 37 27' : 'M 27 30 Q 32 28 37 30' }}
            transition={{ duration: 0.3 }}
          />
          <motion.path
            d={state === 'thinking' ? 'M 63 27 Q 68 25 73 28' : 'M 63 30 Q 68 28 73 30'}
            stroke="#8B6F47"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
            animate={{ d: state === 'thinking' ? 'M 63 27 Q 68 25 73 28' : 'M 63 30 Q 68 28 73 30' }}
            transition={{ duration: 0.3 }}
          />

          {/* Nose */}
          <path d="M 50 45 L 48 50 L 52 50 Z" fill="#D4B5A0" opacity="0.5" />

          {/* Mouth */}
          <motion.path
            d={getMouthPath()}
            stroke="#C1554A"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill={mouthShape === 'round' || mouthShape === 'wide' ? '#C1554A' : 'none'}
            fillOpacity="0.3"
            animate={{ d: getMouthPath() }}
            transition={{ duration: 0.1 }}
          />

          {/* Cheeks - show when speaking */}
          {state === 'speaking' && (
            <>
              <motion.circle
                cx="25"
                cy="52"
                r="5"
                fill="#FF9999"
                opacity="0.4"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2 }}
              />
              <motion.circle
                cx="75"
                cy="52"
                r="5"
                fill="#FF9999"
                opacity="0.4"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2 }}
              />
            </>
          )}
        </svg>

        {/* Voice wave animation when speaking */}
        {state === 'speaking' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
            {[...Array(5)].map((_, i) => (
              <motion.div
                key={i}
                className="w-1 bg-white rounded-full"
                animate={{
                  height: [8, 20, 8],
                }}
                transition={{
                  duration: 0.5,
                  repeat: Infinity,
                  delay: i * 0.1,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
