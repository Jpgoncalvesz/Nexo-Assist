import type { Metadata } from 'next';
import '@fontsource/schibsted-grotesk/400.css';
import '@fontsource/schibsted-grotesk/500.css';
import '@fontsource/schibsted-grotesk/600.css';
import '@fontsource/newsreader/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexo Assist · Service desk de TI',
  description: 'Demonstração local de atendimento de TI com decisões rastreáveis.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
