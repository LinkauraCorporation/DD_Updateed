import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  id: string;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
}

// Module-level reference-counted body scroll lock manager.
// Safely supports nested, concurrent, and re-mounting modals across React lifecycles and auth transitions.
let activeModalCount = 0;
let originalBodyOverflow: string | null = null;

const acquireBodyScrollLock = () => {
  if (typeof document === 'undefined') return;
  if (activeModalCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeModalCount++;
};

const releaseBodyScrollLock = () => {
  if (typeof document === 'undefined') return;
  activeModalCount = Math.max(0, activeModalCount - 1);
  if (activeModalCount === 0) {
    if (originalBodyOverflow !== null) {
      document.body.style.overflow = originalBodyOverflow;
      originalBodyOverflow = null;
    } else {
      document.body.style.overflow = '';
    }
  }
};

export const Modal: React.FC<ModalProps> = ({
  id,
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'lg',
}) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    let isLocked = true;
    acquireBodyScrollLock();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (isLocked) {
        isLocked = false;
        releaseBodyScrollLock();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
  }[maxWidth];

  return (
    <div
      id={id}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/80 backdrop-blur-xs overscroll-contain"
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative w-full ${maxWidthClass} max-h-[min(92vh,calc(100dvh-1.5rem))] sm:max-h-[min(90vh,calc(100dvh-2rem))] bg-slate-900 border border-slate-800/90 rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col min-h-0`}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-800 bg-slate-900/95 shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-base font-bold text-slate-100 tracking-tight truncate">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            id={`${id}-close-btn`}
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 min-h-0 overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
};
