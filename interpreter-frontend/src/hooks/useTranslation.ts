import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';

interface TranslationResult {
  originalText: string;
  translatedText: string | null;
  sourceLanguage: string;
  targetLanguage: string;
  isLoading: boolean;
  error: Error | null;
}

interface UseTranslationResult {
  translate: (text: string, sourceLanguage: string, targetLanguage: string) => Promise<TranslationResult>;
  lastTranslation: TranslationResult | null;
  isTranslating: boolean;
  error: Error | null;
  clearLastTranslation: () => void;
}

/**
 * Hook for translating text between languages
 * Uses the WebSocket connection to the backend which handles the actual translation
 */
export const useTranslation = (): UseTranslationResult => {
  const { sendMessage, lastMessage } = useWebSocket();
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastTranslation, setLastTranslation] = useState<TranslationResult | null>(null);
  
  // Use a ref to track pending translations
  const pendingTranslationRef = useRef<{
    originalText: string;
    sourceLanguage: string;
    targetLanguage: string;
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
  } | null>(null);

  // Handle translation messages from the WebSocket
  useEffect(() => {
    if (!lastMessage) return;
    
    try {
      const message = JSON.parse(lastMessage);
      
      if (message.type === 'translation') {
        console.log('[Translation] Received translation response:', message);
        
        if (pendingTranslationRef.current) {
          const pending = pendingTranslationRef.current;
          
          // Create the translation result
          const result: TranslationResult = {
            originalText: message.originalText || pending.originalText,
            translatedText: message.translatedText || null,
            sourceLanguage: message.sourceLanguage || pending.sourceLanguage,
            targetLanguage: message.targetLanguage || pending.targetLanguage,
            isLoading: false,
            error: null
          };
          
          // Store the last translation
          setLastTranslation(result);
          
          // Resolve the promise
          pending.resolve(result);
          pendingTranslationRef.current = null;
          setIsTranslating(false);
        }
      } else if (message.type === 'error' && pendingTranslationRef.current) {
        // Handle error response
        const error = new Error(message.text || 'Translation failed');
        setError(error);
        
        // Reject the promise
        pendingTranslationRef.current.reject(error);
        pendingTranslationRef.current = null;
        setIsTranslating(false);
      }
    } catch (err) {
      // Not a JSON message or not relevant to translation
    }
  }, [lastMessage]);

  /**
   * Send a translation request to the backend
   */
  const translate = useCallback(async (
    text: string, 
    sourceLanguage: string, 
    targetLanguage: string
  ): Promise<TranslationResult> => {
    // Don't allow multiple concurrent translations
    if (isTranslating) {
      return Promise.reject(new Error('A translation is already in progress'));
    }
    
    // Clear previous errors
    setError(null);
    setIsTranslating(true);
    
    // Return a promise that will resolve when the translation is received
    return new Promise<TranslationResult>((resolve, reject) => {
      try {
        // Store the pending translation info
        pendingTranslationRef.current = {
          originalText: text,
          sourceLanguage,
          targetLanguage,
          resolve,
          reject
        };
        
        // Create a WebSocket message for translation
        const message = {
          type: 'chat_message', // Using existing message type for translation
          payload: {
            text,
            sourceLanguage,
            targetLanguage
          }
        };
        
        // Send the translation request
        console.log('[Translation] Sending translation request:', message);
        sendMessage(message);
        
        // Set a timeout to prevent hanging if no response is received
        setTimeout(() => {
          if (pendingTranslationRef.current) {
            const error = new Error('Translation request timed out');
            pendingTranslationRef.current.reject(error);
            pendingTranslationRef.current = null;
            setIsTranslating(false);
            setError(error);
          }
        }, 10000); // 10 second timeout
        
      } catch (err) {
        // Handle any errors during send
        const error = err instanceof Error ? err : new Error('Failed to send translation request');
        setError(error);
        setIsTranslating(false);
        reject(error);
        pendingTranslationRef.current = null;
      }
    });
  }, [isTranslating, sendMessage]);

  /**
   * Clear the last translation result
   */
  const clearLastTranslation = useCallback(() => {
    setLastTranslation(null);
  }, []);

  return {
    translate,
    lastTranslation,
    isTranslating,
    error,
    clearLastTranslation
  };
};

export default useTranslation; 