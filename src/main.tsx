import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './jb-tokens.css';
import './jb.css';
import { installWebBridge } from './lib/webBridge';

installWebBridge();

createRoot(document.getElementById('root')!).render(<App />);
