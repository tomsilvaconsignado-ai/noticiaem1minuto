import React, { useEffect, useState } from 'react';
import { Sun, CloudSun, Cloud, CloudRain, CloudLightning, CloudFog } from 'lucide-react';

// Clima real de Itabaiana (Open-Meteo) e cotação do dólar (AwesomeAPI), sem chave de API.
// Se alguma consulta falhar, a informação simplesmente não aparece.
const ITABAIANA = { lat: -10.6853, lon: -37.4253 };
const CACHE_KEY = 'n1m_topbar_v1';
const CACHE_MS = 30 * 60 * 1000;

interface Dados {
  temp?: number;
  max?: number;
  min?: number;
  codigo?: number;
  dolar?: number;
  em: number;
}

const lerCache = (): Dados | null => {
  try {
    const d = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    return d && Date.now() - d.em < CACHE_MS ? d : null;
  } catch { return null; }
};
const gravarCache = (d: Dados) => {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* sem armazenamento */ }
};

// Códigos WMO usados pelo Open-Meteo
const descreverTempo = (c?: number): { texto: string; Icone: React.FC<{ className?: string }> } => {
  if (c === undefined) return { texto: '', Icone: Cloud };
  if (c === 0) return { texto: 'Céu limpo', Icone: Sun };
  if (c <= 2) return { texto: 'Parcialmente nublado', Icone: CloudSun };
  if (c === 3) return { texto: 'Nublado', Icone: Cloud };
  if (c <= 48) return { texto: 'Neblina', Icone: CloudFog };
  if (c <= 82) return { texto: 'Chuva', Icone: CloudRain };
  return { texto: 'Trovoadas', Icone: CloudLightning };
};

export const TopBar: React.FC = () => {
  const [dados, setDados] = useState<Dados | null>(() => lerCache());

  useEffect(() => {
    if (dados) return;
    let cancelado = false;
    const clima = fetch(`https://api.open-meteo.com/v1/forecast?latitude=${ITABAIANA.lat}&longitude=${ITABAIANA.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=America%2FBahia&forecast_days=1`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    const dolar = fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
      .then(r => r.ok ? r.json() : null).catch(() => null);
    Promise.all([clima, dolar]).then(([c, d]) => {
      if (cancelado) return;
      const novo: Dados = {
        temp: c?.current?.temperature_2m,
        codigo: c?.current?.weather_code,
        max: c?.daily?.temperature_2m_max?.[0],
        min: c?.daily?.temperature_2m_min?.[0],
        dolar: d?.USDBRL?.bid ? Number(d.USDBRL.bid) : undefined,
        em: Date.now(),
      };
      setDados(novo);
      gravarCache(novo);
    });
    return () => { cancelado = true; };
  }, [dados]);

  const hoje = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const { texto, Icone } = descreverTempo(dados?.codigo);
  const temClima = typeof dados?.temp === 'number';

  return (
    <div className="container mx-auto px-4 h-9 flex items-center gap-5 overflow-x-auto no-scrollbar whitespace-nowrap text-[13px] text-gray-600">
      <span className="first-letter:uppercase text-gray-800 font-medium">{hoje}</span>
      {temClima && (
        <span className="inline-flex items-center gap-1.5" title={texto}>
          <Icone className="w-4 h-4 text-marca" />
          <strong className="font-semibold text-gray-900">{Math.round(dados!.temp!)}°</strong>
          {typeof dados?.max === 'number' && typeof dados?.min === 'number' && (
            <span className="hidden sm:inline text-gray-500">máx. {Math.round(dados.max)}° mín. {Math.round(dados.min)}°</span>
          )}
          <span>hoje em Itabaiana</span>
        </span>
      )}
      {typeof dados?.dolar === 'number' && (
        <span>
          Dólar <strong className="font-semibold text-gray-900">{dados.dolar.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
        </span>
      )}
    </div>
  );
};
