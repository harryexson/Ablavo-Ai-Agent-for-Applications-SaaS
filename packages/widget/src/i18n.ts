const STRINGS = {
  en: {
    chat: "Chat", guide: "Guide", placeholder: "Ask a question…", send: "Send", close: "Close assistant", expand: "Change size",
    thinking: "Thinking…", sources: "Sources", helpful: "Helpful", notHelpful: "Not helpful", confirm: "Confirm", cancel: "Cancel",
    done: "Done", failed: "Couldn't complete that", cancelled: "Cancelled", onboarding: "Getting started", training: "Training",
    noGuides: "No guides are available yet.", start: "Start", resume: "Resume", markDone: "Mark done", skip: "Skip", show: "Show me",
    lockedUntil: "Complete earlier steps first", minutes: "min", completed: "Completed", next: "Next", back: "Back", finish: "Finish",
    waitingFor: "Do this in the app to continue", quiz: "Quick check", submit: "Submit answers", passed: "Passed", tryAgain: "Not quite — review and try again",
    certificate: "Certificate earned", mic: "Speak", speak: "Read replies aloud", contact: "Contact support", poweredBy: "AI assistant · answers come from this app's documentation",
    suggestions: ["How do I get started?", "Show me around", "What can you do?"], sandbox: "Sandbox", restart: "Restart",
  },
  es: {
    chat: "Chat", guide: "Guía", placeholder: "Haz una pregunta…", send: "Enviar", close: "Cerrar asistente", expand: "Cambiar tamaño",
    thinking: "Pensando…", sources: "Fuentes", helpful: "Útil", notHelpful: "No útil", confirm: "Confirmar", cancel: "Cancelar",
    done: "Hecho", failed: "No se pudo completar", cancelled: "Cancelado", onboarding: "Primeros pasos", training: "Formación",
    noGuides: "Aún no hay guías.", start: "Empezar", resume: "Continuar", markDone: "Marcar como hecho", skip: "Omitir", show: "Muéstrame",
    lockedUntil: "Completa los pasos anteriores", minutes: "min", completed: "Completado", next: "Siguiente", back: "Atrás", finish: "Terminar",
    waitingFor: "Hazlo en la aplicación para continuar", quiz: "Comprobación rápida", submit: "Enviar respuestas", passed: "Aprobado", tryAgain: "Casi — repasa e inténtalo de nuevo",
    certificate: "Certificado obtenido", mic: "Hablar", speak: "Leer respuestas en voz alta", contact: "Contactar soporte", poweredBy: "Asistente IA · respuestas basadas en la documentación",
    suggestions: ["¿Cómo empiezo?", "Enséñame la app", "¿Qué puedes hacer?"], sandbox: "Pruebas", restart: "Reiniciar",
  },
  fr: {
    chat: "Discussion", guide: "Guide", placeholder: "Posez une question…", send: "Envoyer", close: "Fermer l'assistant", expand: "Changer la taille",
    thinking: "Réflexion…", sources: "Sources", helpful: "Utile", notHelpful: "Pas utile", confirm: "Confirmer", cancel: "Annuler",
    done: "Terminé", failed: "Impossible de terminer", cancelled: "Annulé", onboarding: "Premiers pas", training: "Formation",
    noGuides: "Aucun guide pour le moment.", start: "Commencer", resume: "Reprendre", markDone: "Marquer comme fait", skip: "Passer", show: "Montrez-moi",
    lockedUntil: "Terminez d'abord les étapes précédentes", minutes: "min", completed: "Terminé", next: "Suivant", back: "Retour", finish: "Terminer",
    waitingFor: "Faites-le dans l'application pour continuer", quiz: "Vérification rapide", submit: "Valider", passed: "Réussi", tryAgain: "Presque — relisez et réessayez",
    certificate: "Certificat obtenu", mic: "Parler", speak: "Lire les réponses", contact: "Contacter le support", poweredBy: "Assistant IA · réponses issues de la documentation",
    suggestions: ["Comment commencer ?", "Faites-moi visiter", "Que pouvez-vous faire ?"], sandbox: "Bac à sable", restart: "Recommencer",
  },
};

export type Strings = (typeof STRINGS)["en"];
export function strings(lang: string): Strings {
  return (STRINGS as Record<string, Strings>)[lang.slice(0, 2)] ?? STRINGS.en;
}
