export interface Logger {
  info: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
  isDebugEnabled: () => boolean;
}

export function createLogger(debugEnabled: boolean): Logger {
  return {
    info(message: string) {
      console.log(message);
    },
    error(message: string) {
      console.error(message);
    },
    debug(message: string) {
      if (debugEnabled) {
        console.log(`[debug] ${message}`);
      }
    },
    isDebugEnabled() {
      return debugEnabled;
    }
  };
}
