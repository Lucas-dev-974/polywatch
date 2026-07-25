import { For, Show } from 'solid-js';
import type { CompareAnalysisReportsResult } from '@polywatch/core';
import { formatShortDateTime } from '../lib/date';

export interface AnalysisReportComparePanelProps {
  data: CompareAnalysisReportsResult;
}

export function AnalysisReportComparePanel(props: AnalysisReportComparePanelProps) {
  return (
    <section class="panel analysis-report-compare">
      <div class="panel-header">
        <h2>Comparaison de rapports</h2>
      </div>
      <div class="panel-body">
        <div class="analysis-report-compare-headers">
          <div>
            <span class="form-hint">Rapport A</span>
            <strong>{props.data.reportA.label}</strong>
            <span class="form-hint">{formatShortDateTime(props.data.reportA.createdAt)}</span>
          </div>
          <div>
            <span class="form-hint">Rapport B</span>
            <strong>{props.data.reportB.label}</strong>
            <span class="form-hint">{formatShortDateTime(props.data.reportB.createdAt)}</span>
          </div>
        </div>
        <table class="data-table analysis-report-compare-table">
          <thead>
            <tr>
              <th>Métrique</th>
              <th>A</th>
              <th>B</th>
              <th>Δ (B − A)</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.data.rows}>
              {(row) => (
                <tr>
                  <td>{row.label}</td>
                  <td>{row.valueA}</td>
                  <td>{row.valueB}</td>
                  <td
                    classList={{
                      'text-positive': row.deltaClass === 'positive',
                      'text-negative': row.deltaClass === 'negative',
                    }}
                  >
                    {row.delta}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <p class="form-hint analysis-report-compare-hint">
          Comparaison de snapshots enregistrés — chaque rapport fige sa config au moment de la
          génération.
        </p>
      </div>
    </section>
  );
}
