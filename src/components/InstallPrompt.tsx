import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // Si el usuario cerró el banner antes, no lo mostramos más
    if (localStorage.getItem('installDismissed') === 'true') {
      return;
    }

    // Detectar si ya está instalada o estamos en standalone
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(standalone);

    if (standalone) return; // Si ya está instalada, no mostramos nada

    // Para Android / Chrome
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Para iOS / Safari
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    
    if (isIosDevice && !standalone) {
      setIsIOS(true);
      setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('installDismissed', 'true');
    setShowPrompt(false);
  };

  // No mostrar en el panel de admin ni si ya está instalado/descartado
  if (!showPrompt || isStandalone || location.pathname.startsWith('/admin')) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 z-50 animate-fade-in-up">
      <div className="bg-slate-900 text-white rounded-xl shadow-2xl p-4 border border-slate-700 max-w-md mx-auto">
        <div className="flex items-start gap-4">
          <div className="bg-primary/20 p-2 rounded-lg shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-primary-light" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg leading-tight mb-1">¡Instala la App!</h3>
            
            {isIOS ? (
              <div className="text-sm text-slate-300 leading-snug">
                Para instalarla en tu iPhone:
                <ol className="mt-2 space-y-1 ml-4 list-decimal">
                  <li>Toca el botón Compartir <span className="inline-block border border-slate-500 rounded p-0.5 align-middle"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg></span></li>
                  <li>Selecciona <strong>Agregar a Inicio</strong></li>
                </ol>
              </div>
            ) : (
              <p className="text-sm text-slate-300 leading-snug mb-3">
                Agrega esta app a tu pantalla de inicio para reservar tus turnos más rápido y sin entrar al navegador.
              </p>
            )}

            <div className="mt-3 flex gap-2 justify-end">
              <button 
                onClick={handleDismiss} 
                className="px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-white transition-colors"
              >
                Cerrar
              </button>
              
              {!isIOS && (
                <button 
                  onClick={handleInstallClick}
                  className="bg-primary hover:bg-primary-hover text-white px-4 py-1.5 rounded-md text-sm font-bold shadow-sm transition-colors"
                >
                  Instalar App
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
