import { AudioLines } from 'lucide-react';

export default function BootScreen(): JSX.Element {
  return (
    <div className="boot-screen">
      <span className="boot-mark">
        <AudioLines size={22} />
      </span>
      <span className="boot-text">正在准备耳畔</span>
    </div>
  );
}
