import { Component as NgComponent } from '@angular/core';

@NgComponent({
  selector: 'analysis-probe',
  standalone: true,
  templateUrl: './probe.component.html',
})
export class ProbeComponent {
  protected readonly showLink = true;
  protected readonly messages = {
    title: 'Title',
    about: 'About',
    deferred: 'Deferred',
  } as const;
}
