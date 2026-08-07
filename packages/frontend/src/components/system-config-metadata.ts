export type SystemConfigUnit = 'ms' | 'seconds' | 'count' | 'ratio' | 'decimals' | 'boolean';

export interface SystemConfigKeyMeta {
  label: string;
  hint: string;
  group: string;
  unit?: SystemConfigUnit;
  unitLabel?: string;
}

export const SYSTEM_CONFIG_CATEGORY_META: Record<
  string,
  { label: string; description: string }
> = {
  worker: {
    label: 'Worker',
    description:
      'Fréquence des boucles d’exécution, timeouts WebSocket, durées de cache et garde-fous du worker qui pilote les ordres et la stratégie.',
  },
  surveillance: {
    label: 'Surveillance',
    description:
      'Délais de capture des snapshots à l’ouverture et à la fermeture des positions, plus seuils de prix pour qualifier un gain ou une perte.',
  },
  auto_track: {
    label: 'Auto-Track',
    description:
      'Cadence de synchronisation des marchés suivis automatiquement et limites de pagination vers l’API Gamma.',
  },
  backend: {
    label: 'Backend',
    description:
      'Durées de mise en cache côté API et plafonds des requêtes externes (Polygonscan, tags marché, funding).',
  },
};

export const SYSTEM_CONFIG_GROUP_LABELS: Record<string, string> = {
  heartbeat: 'Heartbeat & connectivité',
  websocket: 'WebSocket',
  polling: 'Boucles de surveillance',
  strategy: 'Stratégie & exécution',
  cache: 'Caches & fraîcheur des données',
  clob: 'CLOB & ordres',
  safety: 'Sécurité & circuit breaker',
  logging: 'Logs',
  api: 'API & pagination',
  snapshots: 'Snapshots de position',
  thresholds: 'Seuils gain / perte',
  sync: 'Synchronisation des marchés',
  janitor: 'Nettoyage périodique',
  cache_backend: 'Caches API',
  auth: 'Authentification',
  polygonscan: 'Polygonscan',
};

/** Ordre d’affichage des groupes par catégorie. */
export const SYSTEM_CONFIG_GROUP_ORDER: Record<string, string[]> = {
  worker: [
    'heartbeat',
    'websocket',
    'polling',
    'strategy',
    'cache',
    'clob',
    'safety',
    'logging',
    'api',
  ],
  surveillance: ['snapshots', 'thresholds'],
  auto_track: ['sync', 'janitor', 'api'],
  backend: ['cache_backend', 'auth', 'polygonscan'],
};

export const SYSTEM_CONFIG_KEY_META: Record<string, SystemConfigKeyMeta> = {
  'worker.heartbeat.interval_ms': {
    label: 'Intervalle heartbeat',
    hint: 'Fréquence d’émission du signal « worker vivant » vers le backend et les dashboards.',
    group: 'heartbeat',
    unit: 'ms',
  },
  'worker.book.subscription_sync_ms': {
    label: 'Sync abonnements carnet',
    hint: 'Vérifie que les abonnements WebSocket du carnet d’ordres correspondent aux positions actives.',
    group: 'websocket',
    unit: 'ms',
  },
  'worker.ws.heartbeat_interval_ms': {
    label: 'Ping WebSocket',
    hint: 'Intervalle des pings pour maintenir la connexion marché ouverte.',
    group: 'websocket',
    unit: 'ms',
  },
  'worker.ws.stale_book_threshold_ms': {
    label: 'Seuil carnet obsolète',
    hint: 'Au-delà de ce délai sans mise à jour, le carnet est resynchronisé via REST.',
    group: 'websocket',
    unit: 'ms',
  },
  'worker.ws.max_reconnect_attempts': {
    label: 'Tentatives de reconnexion',
    hint: 'Nombre maximal de tentatives avant d’abandonner la reconnexion WebSocket.',
    group: 'websocket',
    unit: 'count',
    unitLabel: 'tentatives',
  },
  'worker.ws.connect_timeout_ms': {
    label: 'Timeout de connexion WS',
    hint: 'Délai maximum pour établir une connexion WebSocket avant échec.',
    group: 'websocket',
    unit: 'ms',
  },
  'worker.ws.base_reconnect_delay_ms': {
    label: 'Délai de reconnexion initial',
    hint: 'Premier délai du backoff exponentiel entre deux reconnexions WebSocket.',
    group: 'websocket',
    unit: 'ms',
  },
  'worker.market_resolution.loop_ms': {
    label: 'Surveillance résolution marché',
    hint: 'Fréquence de vérification des marchés en cours de résolution.',
    group: 'polling',
    unit: 'ms',
  },
  'worker.redemption.loop_ms': {
    label: 'Gestion des redemptions',
    hint: 'Fréquence de traitement des positions éligibles au rachat après résolution.',
    group: 'polling',
    unit: 'ms',
  },
  'worker.closing_watchdog.loop_ms': {
    label: 'Watchdog de clôture',
    hint: 'Surveille les positions bloquées en fermeture et relance si nécessaire.',
    group: 'polling',
    unit: 'ms',
  },
  'worker.reservation_janitor.loop_ms': {
    label: 'Janitor des réservations',
    hint: 'Nettoie les réservations de capital expirées ou orphelines.',
    group: 'polling',
    unit: 'ms',
  },
  'worker.placing_janitor.loop_ms': {
    label: 'Janitor des ordres en placement',
    hint: 'Détecte et annule les ordres restés trop longtemps en état « placing ».',
    group: 'polling',
    unit: 'ms',
  },
  'worker.kill_switch.check_interval_ms': {
    label: 'Vérification kill switch',
    hint: 'Fréquence de relecture de l’état du kill switch (blocage entrées / fermeture forcée).',
    group: 'polling',
    unit: 'ms',
  },
  'worker.market_refresh.throttle_ms': {
    label: 'Throttle refresh marché',
    hint: 'Délai minimum entre deux rafraîchissements du cycle de vie d’un marché.',
    group: 'polling',
    unit: 'ms',
  },
  'worker.strategy.eval_interval_ms': {
    label: 'Évaluation stratégie',
    hint: 'Fréquence de la boucle qui évalue les signaux et décisions de trading.',
    group: 'strategy',
    unit: 'ms',
  },
  'worker.forced_exit.retry_cooldown_ms': {
    label: 'Cooldown sortie forcée',
    hint: 'Espacement minimum entre deux tentatives de sortie forcée sur la même position.',
    group: 'strategy',
    unit: 'ms',
  },
  'worker.sl_confirmation.min_window_ms': {
    label: 'Fenêtre confirmation stop-loss',
    hint: 'Durée minimale pendant laquelle le prix doit rester sous le SL avant déclenchement.',
    group: 'strategy',
    unit: 'ms',
  },
  'worker.pnl_tick.throttle_ms': {
    label: 'Throttle tick PnL',
    hint: 'Limite la fréquence de recalcul et diffusion du PnL non réalisé.',
    group: 'strategy',
    unit: 'ms',
  },
  'worker.backend_ready.timeout_ms': {
    label: 'Timeout backend prêt',
    hint: 'Temps d’attente maximal du signal indiquant que le backend est opérationnel au démarrage.',
    group: 'heartbeat',
    unit: 'ms',
  },
  'worker.real_balance.cache_ttl_ms': {
    label: 'Cache solde réel',
    hint: 'Durée de validité du solde pUSD réel avant une nouvelle requête CLOB.',
    group: 'cache',
    unit: 'ms',
  },
  'worker.tick_size.cache_ttl_ms': {
    label: 'Cache tick size',
    hint: 'Durée de mémorisation du pas de prix minimum par marché.',
    group: 'cache',
    unit: 'ms',
  },
  'worker.fee_rate.cache_ttl_ms': {
    label: 'Cache taux de frais',
    hint: 'Durée de mémorisation des frais CLOB par token.',
    group: 'cache',
    unit: 'ms',
  },
  'worker.book_freshness.warn_max_age_ms': {
    label: 'Alerte carnet périmé',
    hint: 'Seuil d’âge du carnet au-delà duquel un avertissement est émis dans les logs.',
    group: 'cache',
    unit: 'ms',
  },
  'worker.last_trade_price.max_age_ms': {
    label: 'Âge max dernier trade',
    hint: 'Au-delà de ce délai, le dernier prix exécuté est considéré comme obsolète.',
    group: 'cache',
    unit: 'ms',
  },
  'worker.clob.order_timeout_ms': {
    label: 'Timeout ordre CLOB',
    hint: 'Délai maximum d’attente de confirmation d’un ordre envoyé au CLOB.',
    group: 'clob',
    unit: 'ms',
  },
  'worker.clob.amount_decimals': {
    label: 'Décimales montant CLOB',
    hint: 'Nombre de décimales utilisées pour formater les montants envoyés au CLOB.',
    group: 'clob',
    unit: 'decimals',
    unitLabel: 'décimales',
  },
  'worker.clob.position_lock_timeout_ms': {
    label: 'Timeout verrou position',
    hint: 'Durée maximale d’un verrou exclusif sur une position avant libération automatique.',
    group: 'clob',
    unit: 'ms',
  },
  'worker.circuit_breaker.failure_threshold': {
    label: 'Seuil circuit breaker',
    hint: 'Nombre d’échecs consécutifs avant coupure temporaire des appels externes.',
    group: 'safety',
    unit: 'count',
    unitLabel: 'échecs',
  },
  'worker.circuit_breaker.cooldown_ms': {
    label: 'Cooldown circuit breaker',
    hint: 'Durée de pause après déclenchement du circuit breaker avant nouvel essai.',
    group: 'safety',
    unit: 'ms',
  },
  'worker.log.book_404_errors': {
    label: 'Logger les erreurs 404 carnet',
    hint: 'Affiche dans la console les avertissements CLOB book 404 (souvent transitoires sur tokens nouveaux ou expirés). Désactivé par défaut pour éviter le bruit.',
    group: 'logging',
    unit: 'boolean',
  },
  'worker.data_api.page_limit': {
    label: 'Taille de page Data API',
    hint: 'Nombre d’éléments récupérés par page lors des appels Data API.',
    group: 'api',
    unit: 'count',
    unitLabel: 'éléments',
  },
  'worker.data_api.max_pages': {
    label: 'Pages max Data API',
    hint: 'Limite de pagination pour éviter les boucles de requêtes trop longues.',
    group: 'api',
    unit: 'count',
    unitLabel: 'pages',
  },

  'surveillance.open_snapshot_delay_ms': {
    label: 'Délai snapshot à l’ouverture',
    hint: 'Temps d’attente après ouverture avant de capturer l’état initial de la position.',
    group: 'snapshots',
    unit: 'ms',
  },
  'surveillance.close_snapshot_delay_ms': {
    label: 'Délai snapshot à la fermeture',
    hint: 'Temps d’attente après fermeture avant de capturer l’état final.',
    group: 'snapshots',
    unit: 'ms',
  },
  'surveillance.close_ttl_ms': {
    label: 'Timeout snapshot de clôture',
    hint: 'Délai maximum d’attente du snapshot de fermeture avant abandon.',
    group: 'snapshots',
    unit: 'ms',
  },
  'surveillance.redemption_win_threshold': {
    label: 'Seuil prix « gain »',
    hint: 'Prix au-dessus duquel une position résolue est classée comme gagnante.',
    group: 'thresholds',
    unit: 'ratio',
  },
  'surveillance.redemption_loss_threshold': {
    label: 'Seuil prix « perte »',
    hint: 'Prix en dessous duquel une position résolue est classée comme perdante.',
    group: 'thresholds',
    unit: 'ratio',
  },

  'auto_track.fetch_page_size': {
    label: 'Taille de page Gamma',
    hint: 'Nombre de marchés récupérés par page lors du scan auto-track.',
    group: 'api',
    unit: 'count',
    unitLabel: 'marchés',
  },
  'auto_track.max_pages': {
    label: 'Pages max Gamma',
    hint: 'Limite de pages parcourues pour éviter de surcharger l’API Gamma.',
    group: 'api',
    unit: 'count',
    unitLabel: 'pages',
  },
  'auto_track.sync_min_interval_ms': {
    label: 'Intervalle min de sync',
    hint: 'Délai minimum entre deux synchronisations complètes des marchés auto-track.',
    group: 'sync',
    unit: 'ms',
  },
  'auto_track.future_markets_sync_min_interval_ms': {
    label: 'Sync marchés futurs',
    hint: 'Délai minimum entre deux mises à jour des marchés à échéance future.',
    group: 'sync',
    unit: 'ms',
  },
  'auto_track.janitor.short_interval_ms': {
    label: 'Janitor (intervalles courts)',
    hint: 'Cadence de nettoyage pour les marchés à horizon temporel court.',
    group: 'janitor',
    unit: 'ms',
  },
  'auto_track.janitor.default_interval_ms': {
    label: 'Janitor (intervalle par défaut)',
    hint: 'Cadence standard de nettoyage des entrées auto-track obsolètes.',
    group: 'janitor',
    unit: 'ms',
  },

  'backend.cache.market_tags.ttl_ms': {
    label: 'Cache tags marché',
    hint: 'Durée de conservation des libellés et catégories de marchés en mémoire.',
    group: 'cache_backend',
    unit: 'ms',
  },
  'backend.cache.funding.ttl_ms': {
    label: 'Cache funding traders',
    hint: 'Durée de validité des données de financement récupérées via Polygonscan.',
    group: 'cache_backend',
    unit: 'ms',
  },
  'backend.auth.refresh_token.ttl_seconds': {
    label: 'Durée refresh token',
    hint: 'Durée de vie d’un jeton de rafraîchissement avant expiration de session.',
    group: 'auth',
    unit: 'seconds',
  },
  'backend.polygonscan.max_offset': {
    label: 'Offset max Polygonscan',
    hint: 'Plafond de décalage de pagination pour les requêtes historiques Polygonscan.',
    group: 'polygonscan',
    unit: 'count',
  },
  'backend.polygonscan.max_windows': {
    label: 'Fenêtres max Polygonscan',
    hint: 'Nombre maximal de fenêtres temporelles parcourues par requête de funding.',
    group: 'polygonscan',
    unit: 'count',
    unitLabel: 'fenêtres',
  },
};

export function getSystemConfigMeta(key: string): SystemConfigKeyMeta {
  const known = SYSTEM_CONFIG_KEY_META[key];
  if (known) return known;

  const shortKey = key.split('.').pop() ?? key;
  const label = shortKey
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    label,
    hint: 'Paramètre système sans description dédiée.',
    group: 'other',
  };
}

export function formatSystemConfigValue(
  value: string,
  unit?: SystemConfigUnit,
  unitLabel?: string,
): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;

  if (unit === 'ms') {
    if (num >= 86_400_000) return `${trimTrailingZero(num / 86_400_000)} j`;
    if (num >= 3_600_000) return `${trimTrailingZero(num / 3_600_000)} h`;
    if (num >= 60_000) return `${trimTrailingZero(num / 60_000)} min`;
    if (num >= 1_000) return `${trimTrailingZero(num / 1_000)} s`;
    return `${num} ms`;
  }

  if (unit === 'seconds') {
    if (num >= 86_400) return `${trimTrailingZero(num / 86_400)} j`;
    if (num >= 3_600) return `${trimTrailingZero(num / 3_600)} h`;
    if (num >= 60) return `${trimTrailingZero(num / 60)} min`;
    return `${num} s`;
  }

  if (unit === 'ratio') {
    return `${trimTrailingZero(num * 100)} %`;
  }

  if (unit === 'boolean') {
    return value === 'true' || value === '1' ? 'activé' : 'désactivé';
  }

  if (unitLabel) return `${value} ${unitLabel}`;
  return value;
}

function trimTrailingZero(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

export interface GroupedSystemConfigEntries<T extends { key: string; category: string | null }> {
  group: string;
  label: string;
  entries: T[];
}

export function groupSystemConfigEntries<
  T extends { key: string; category: string | null },
>(entries: T[], category: string | null): GroupedSystemConfigEntries<T>[] {
  const filtered = category
    ? entries.filter((e) => e.category === category)
    : entries;

  const byGroup = new Map<string, T[]>();
  for (const entry of filtered) {
    const cat = entry.category ?? 'other';
    const meta = getSystemConfigMeta(entry.key);
    const group = meta.group;
    const list = byGroup.get(group) ?? [];
    list.push(entry);
    byGroup.set(group, list);
  }

  const order = category
    ? (SYSTEM_CONFIG_GROUP_ORDER[category] ?? [])
    : Array.from(
        new Set(
          filtered.map((e) => getSystemConfigMeta(e.key).group),
        ),
      );

  const groups: GroupedSystemConfigEntries<T>[] = [];
  for (const group of order) {
    const groupEntries = byGroup.get(group);
    if (!groupEntries?.length) continue;
    groups.push({
      group,
      label: SYSTEM_CONFIG_GROUP_LABELS[group] ?? group,
      entries: groupEntries,
    });
    byGroup.delete(group);
  }

  for (const [group, groupEntries] of byGroup) {
    if (!groupEntries.length) continue;
    groups.push({
      group,
      label: SYSTEM_CONFIG_GROUP_LABELS[group] ?? group,
      entries: groupEntries,
    });
  }

  return groups;
}
