import { motion } from 'framer-motion';
import { Sparkles, ShieldCheck } from 'lucide-react';

/**
 * AiConsentModal
 *
 * One-time, first-run disclosure + permission before any journal or health data
 * is sent to third-party AI providers (Apple App Review 5.1.2(i); also aligns
 * with WA My Health My Data and FTC guidance). Users may continue with typed
 * capture while AI features remain disabled. The preference is recorded by the caller.
 */
const AiConsentModal = ({ onAgree, onDecline, agreeing = false }) => {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-hearth-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-sage-100 dark:bg-sage-900/40 flex items-center justify-center">
            <Sparkles className="text-sage-600 dark:text-sage-300" size={22} />
          </div>
          <h2 className="font-display font-bold text-xl text-warm-800 dark:text-warm-100">
            How Engram uses AI
          </h2>
        </div>

        <p className="text-sm text-warm-600 dark:text-warm-300 mb-3">
          To turn your entries into insights, Engram sends some of your data to
          trusted AI providers acting on our behalf:
        </p>

        <ul className="text-sm text-warm-600 dark:text-warm-300 space-y-2 mb-4 list-disc pl-5">
          <li><strong>Your journal text</strong> is sent to Google Gemini for mood analysis, pattern detection, and insights.</li>
          <li><strong>Voice recordings</strong> are sent to OpenAI to transcribe them and (in voice conversations) to power the AI companion.</li>
          <li><strong>Health &amp; weather context</strong> you connect is used only to add context — never for advertising. Weather and daylight context comes from Open-Meteo and sunrise-sunset.org, using your approximate (rounded) location.</li>
        </ul>

        <div className="rounded-xl bg-sage-50 dark:bg-sage-900/20 border border-sage-200/50 dark:border-sage-800/40 px-4 py-3 mb-4">
          <div className="flex items-start gap-2">
            <ShieldCheck size={18} className="text-sage-600 dark:text-sage-300 mt-0.5 shrink-0" />
            <p className="text-xs text-warm-600 dark:text-warm-300 leading-relaxed">
              Engram uses provider API services only to return your result and
              never sells your data or uses it for advertising. Provider handling
              follows the configured service terms described in our{' '}
              <a href="/privacy-policy.html" target="_blank" rel="noreferrer" className="underline text-sage-700 dark:text-sage-300">Privacy Policy</a>.
            </p>
          </div>
        </div>

        <p className="text-xs text-warm-500 dark:text-warm-400 mb-4">
          Engram is a general-wellness tool for self-reflection — not therapy, not
          a medical device, and not a crisis service. You can review this anytime
          in Settings.
        </p>

        <button
          onClick={onAgree}
          disabled={agreeing}
          className="w-full py-3 rounded-xl bg-sage-600 text-white font-semibold hover:bg-sage-700 disabled:opacity-60 transition-colors"
        >
          {agreeing ? 'Saving…' : 'I understand and agree'}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={agreeing}
          className="mt-2 min-h-11 w-full rounded-xl font-semibold text-[var(--secondary-foreground)] disabled:opacity-60"
        >
          Continue without AI
        </button>
      </motion.div>
    </div>
  );
};

export default AiConsentModal;
