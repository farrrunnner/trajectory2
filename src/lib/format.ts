import { format, parseISO } from 'date-fns';

export const formatDistanceKm = (meters: number) => `${(meters / 1000).toFixed(2)} km`;

export const formatDuration = (seconds: number) => {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const remainingSeconds = (total % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainingSeconds}`;
};

export const formatSpeedKmh = (mps: number | null | undefined) =>
  mps == null ? 'n/a' : `${(mps * 3.6).toFixed(1)} km/h`;

export const formatPaceMinKm = (mps: number | null | undefined) => {
  if (!mps || mps <= 0) {
    return 'n/a';
  }

  const secPerKm = 1000 / mps;
  const minutes = Math.floor(secPerKm / 60);
  const seconds = Math.floor(secPerKm % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds} /km`;
};

export const formatDateTime = (iso: string) => format(parseISO(iso), 'dd.MM.yyyy HH:mm:ss');

export const formatDate = (iso: string) => format(parseISO(iso), 'dd.MM.yyyy');
