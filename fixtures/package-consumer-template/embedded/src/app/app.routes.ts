import { Component } from '@angular/core';
import type { Routes } from '@angular/router';

@Component({
  selector: 'app-panel-page',
  template: `<p data-route-view="panel"></p>`,
})
class PanelPage {}

@Component({
  selector: 'app-about-page',
  template: `<p data-route-view="about"></p>`,
})
class AboutPage {}

@Component({
  selector: 'app-settings-page',
  template: `<p data-route-view="settings"></p>`,
})
class SettingsPage {}

export const routes: Routes = [
  { path: '', component: PanelPage },
  { path: 'about', component: AboutPage },
  { path: 'settings', component: SettingsPage },
];
