import { LoginForm } from '@/components/login';
export const metadata={title:'Anmelden',robots:{index:false,follow:false}};
export default function Page(){return <div className="login-page"><div className="login-intro"><span className="eyebrow accent">DEIN PRIVATER VORFÜHRRAUM</span><h1>Willkommen<br/>zurück<span className="accent">.</span></h1><p>Deine History, Bewertungen und Filmabende.<br/>Nur für dich.</p></div><LoginForm/></div>;}
