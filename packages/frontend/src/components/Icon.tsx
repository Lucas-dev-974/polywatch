type Props = {
  name: string;
  size?: number;
};

const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none' as const,
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
};

export function Icon(props: Props) {
  const size = () => props.size ?? 14;

  if (props.name === 'chevron-up') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24">
        <polyline points="18 15 12 9 6 15" />
      </svg>
    );
  }

  if (props.name === 'chevron-down') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    );
  }

  if (props.name === 'chevron-left') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24">
        <polyline points="15 18 9 12 15 6" />
      </svg>
    );
  }

  if (props.name === 'chevron-right') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    );
  }

  if (props.name === 'list') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    );
  }

  if (props.name === 'columns') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="18" rx="1" />
      </svg>
    );
  }

  if (props.name === 'search') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    );
  }

  if (props.name === 'chart-line') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3v18h18" />
        <path d="M7 16l4-6 4 3 5-7" />
      </svg>
    );
  }

  if (props.name === 'clock') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }

  if (props.name === 'eye') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (props.name === 'eye-off') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }

  if (props.name === 'zap') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }

  if (props.name === 'activity') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
  }

  if (props.name === 'briefcase') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    );
  }

  if (props.name === 'trash') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    );
  }

  if (props.name === 'history') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3" />
        <path d="M12 7v5l3 3" />
      </svg>
    );
  }

  if (props.name === 'maximize') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </svg>
    );
  }

  if (props.name === 'minimize') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 14h6v6" />
        <path d="M20 10h-6V4" />
        <path d="M14 10l7-7" />
        <path d="M3 21l7-7" />
      </svg>
    );
  }

  if (props.name === 'bell') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
  }

  if (props.name === 'trending-up') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  }

  if (props.name === 'cloud') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    );
  }

  if (props.name === 'copy') {
    return (
      <svg {...svgProps} width={size()} height={size()} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }

  return null;
}
