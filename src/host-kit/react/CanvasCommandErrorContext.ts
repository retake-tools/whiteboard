import { createContext } from 'react';

export const CanvasCommandErrorContext = createContext<(error: unknown) => void>(
  (error) => console.error(error),
);
