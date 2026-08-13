import { Show } from 'solid-js';

export interface PaginationProps {
  page: number;
  pageCount: number;
  onPage: (next: number) => void;
  disabled?: boolean;
  /** Masque la pagination si le total ne dépasse pas une page. */
  showIfSingle?: boolean;
}

/** Pagination partagée (R2/R3) — boutons Préc./Suiv. + compteur. */
export function Pagination(props: PaginationProps) {
  return (
    <Show when={props.showIfSingle || props.pageCount > 1}>
      <div class="algo-pagination weather-data-pagination">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={props.page === 0 || props.disabled}
          onClick={() => props.onPage(Math.max(0, props.page - 1))}
        >
          Préc.
        </button>
        <span class="algo-pagination-info">
          {props.page + 1} / {props.pageCount}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={props.page >= props.pageCount - 1 || props.disabled}
          onClick={() => props.onPage(props.page + 1)}
        >
          Suiv.
        </button>
      </div>
    </Show>
  );
}
