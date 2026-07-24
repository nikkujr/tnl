import { Component, Input, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import {
  AlertTriangle, BadgeDollarSign, Bell, Boxes, Check, ChevronDown, ChevronRight, CircleUserRound, ClipboardList, Gauge,
  LayoutDashboard, Mail, MapPinned, Megaphone, Menu, Package, PackageSearch,
  Pencil, Plus, RotateCcw, Search, Tags, Trash2, UserCog, UserRoundSearch,
  UsersRound, Warehouse, X, type IconNode
} from 'lucide';

const ICONS = {
  dashboard: LayoutDashboard, orders: ClipboardList, customers: UsersRound,
  categories: Tags, products: Package, inventory: Warehouse, tracking: MapPinned,
  leads: UserRoundSearch, campaigns: Megaphone, agents: UserCog,
  commissions: BadgeDollarSign, bell: Bell, plus: Plus, menu: Menu, close: X,
  check: Check, edit: Pencil, delete: Trash2, email: Mail, search: Search,
  restore: RotateCcw, account: CircleUserRound, catalog: Boxes,
  packageSearch: PackageSearch, gauge: Gauge, chevronDown: ChevronDown, chevronRight: ChevronRight,
  alert: AlertTriangle
} satisfies Record<string, IconNode>;

export type AppIconName = keyof typeof ICONS;

@Component({
  selector: 'app-icon',
  template: '<span class="icon-shell" aria-hidden="true" [innerHTML]="svg"></span>',
  styles: [':host{width:1em;height:1em;display:inline-grid;place-items:center;flex:none}.icon-shell{width:100%;height:100%;display:contents}.icon-shell svg{width:100%;height:100%;display:block}']
})
export class AppIconComponent {
  private readonly sanitizer = inject(DomSanitizer);
  svg: SafeHtml = '';

  @Input({ required: true }) set name(value: AppIconName) {
    const children = ICONS[value].map(([tag, attrs]) => {
      const attributes = Object.entries(attrs).map(([key, entry]) => `${key}="${String(entry)}"`).join(' ');
      return `<${tag} ${attributes}></${tag}>`;
    }).join('');
    this.svg = this.sanitizer.bypassSecurityTrustHtml(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`
    );
  }
}
