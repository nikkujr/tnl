import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { ProductMovement } from './reports.model';

@Component({
  selector: 'app-product-ranking',
  imports: [DecimalPipe],
  template: `
    <section class="ranking">
      <h3>{{ title() }}</h3>
      <p>{{ description() }}</p>
      @if (products().length) {
        <div
          class="bars"
          role="img"
          [attr.aria-label]="title() + ' chart, units sold. Exact values in the table below.'"
        >
          @for (product of products(); track product.id) {
            <div class="bar-row">
              <span [title]="product.name">{{ product.name }}</span>
              <div class="track">
                <i
                  [class.slow]="slow()"
                  [style.width.%]="(100 * product.unitsSold) / maximum()"
                ></i>
              </div>
              <strong>{{ product.unitsSold | number }}</strong>
            </div>
          }
        </div>
        <div class="table-scroll" tabindex="0" [attr.aria-label]="title() + ' table'">
          <table>
            <caption>
              {{
                title()
              }}
              — units sold in the selected period
            </caption>
            <thead>
              <tr>
                <th scope="col">Rank / Product</th>
                <th scope="col">Units sold</th>
                <th scope="col">On hand now</th>
                <th scope="col">Available now</th>
                <th scope="col">Last sale in period</th>
              </tr>
            </thead>
            <tbody>
              @for (product of products(); track product.id; let rank = $index) {
                <tr>
                  <th scope="row">
                    <span>{{ rank + 1 }}. {{ product.name }}</span
                    ><small>{{ product.sku }}</small>
                  </th>
                  <td>{{ product.unitsSold | number }}</td>
                  <td>{{ product.stockOnHand | number }}</td>
                  <td>{{ product.available | number }}</td>
                  <td>{{ product.lastSoldDate ?? 'No sales in period' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else {
        <div class="empty">
          {{
            slow()
              ? 'No active products with stock on hand.'
              : 'No completed product sales in this period.'
          }}
        </div>
      }
    </section>
  `,
  styleUrl: './product-ranking.component.scss',
})
export class ProductRankingComponent {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly products = input.required<ProductMovement[]>();
  readonly slow = input(false);
  readonly maximum = computed(() =>
    Math.max(1, ...this.products().map((p) => Number(p.unitsSold))),
  );
}
