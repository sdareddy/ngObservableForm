import {
  AfterContentInit,
  AfterViewInit,
  ContentChildren,
  Directive,
  EventEmitter,
  HostListener,
  OnDestroy,
  OnInit,
  Output,
  ɵgetHostElement as getHostElement
} from '@angular/core';
import { combineLatest, concat, merge, Observable, Subject } from 'rxjs';
import {
  distinctUntilChanged,
  map,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
  throttleTime
} from 'rxjs/operators';
import { isEmptyObject } from 'src/utils/isObjectEmpty';
import { InputNameDirective } from '../input/input-name.directive';

@Directive({
  // tslint:disable-next-line:directive-selector
  selector: 'form[observable]',
  exportAs: 'observableForm'
})
export class ObservableFormDirective
  implements OnInit, AfterContentInit, AfterViewInit, OnDestroy {
  view$ = new Subject<void>();
  content$ = new Subject<void>();
  init$ = new Subject<void>();
  destroy$ = new Subject<void>();
  /**
   * TODO: considder adding viewChildren.
   * Perhaps, when there is a compelling use-case
   * additional info, in this spirit both afterXInit events are already handled.
   */
  @ContentChildren(InputNameDirective, { descendants: true }) private inputsCc;
  // tslint:disable-next-line:no-output-rename
  @Output('observable') private exposeForm = new EventEmitter<
    Observable<any>
  >();

  // tslint:disable-next-line:no-output-rename
  @Output() save = new EventEmitter();

  formData$: Observable<any> = this.init$.pipe(
    throttleTime(200), // make sure it doesn't refire to rapidly
    /** use an helper to get the observables from the inputs */
    map(() => gatherFormObservables(this.inputsCc)),
    switchMap(formObservables =>
      /** make it update on every input firing off */
      combineLatest(Object.values(formObservables)).pipe(
        tap(vals => console.log('vals', vals)),
        /** the result is an array */
        map(results =>
          /** reduce it back to a json-like data structure */
          Object.keys(formObservables).reduce(
            (t, key, i) => ({ ...t, [key]: results[i] }),
            {}
          )
        )
      )
    ),
    /** make sure we can share/reuse this data by keepin an 'buffer' */
    shareReplay(1),
    /** make sure all is terminated  */
    takeUntil(this.destroy$)
  );

  /**
   * subscribe to init, so we can export the formData$ observable
   * with the eventemitter. this might be subject to change.
   */
  private initSub = this.init$.subscribe(() =>
    this.exposeForm.emit(this.formData$)
  );

  /** listen to the reset events on the form, and just make init refire to 'reset' all data */
  @HostListener('reset')
  private onreset() {
    this.init$.next();
  }
  @HostListener('submit', ['$event']) private async handleSubmit(
    ev: MouseEvent
  ) {
    try {
      // tslint:disable-next-line:no-unused-expression
      ev && ev.preventDefault();
      // tslint:disable-next-line:no-unused-expression
      ev && ev.stopPropagation();
      const formData = Object.entries(
        await this.formData$.pipe(take(1)).toPromise()
      )
        .filter(r => r[1] !== undefined)
        .reduce((r, [key, val]) => ({ ...r, [key]: val }), {});
      // tslint:disable-next-line:no-unused-expression
      !isEmptyObject(formData) && this.save.emit(formData);
    } catch (e) {
      /** stubb */
    }
  }

  /** constructor */
  constructor() {}

  ngOnInit() {
    // fire off init when view and content are done, everything completes, no unsub.
    concat(this.view$, this.content$).subscribe(() => {
      /**
       * make sure the init is fired in the next microTask.
       * This is needed bcs when it fires, not all subscriptions might
       * be active yet.
       */
      Promise.resolve().then(() => this.init$.next());
      /** subscribe so the observables are readily availble when needed. */
      this.formData$.subscribe();
    });
  }

  /** fire&complete  */
  ngAfterContentInit() {
    this.content$.next();
    this.content$.complete();
  }

  /** fire&complete  */
  ngAfterViewInit() {
    this.view$.next();
    this.view$.complete();
  }

  /** unsubscribe the single subscription on destroy */
  ngOnDestroy(): void {
    this.initSub.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
  }
}

export interface FormObservers {
  [x:string]: Observable<any>;
}

/**
 * Gather all available inputs into a single object
 *   { [formEntryName]: Observable<inputType>}
 * this mathes the json structure of the model
 */
export function gatherFormObservables(inputs: InputNameDirective[]):FormObservers {
  const inputObservers = inputs.reduce((combinedObservers, el) => {
    if (combinedObservers[el.name]) {
      /**
       * The same name already exists, merge the additional
       * one so it is exposed as a single observable.
       * note that only the last one that fire's wins.
       * This works well for radio buttons. No other inputs should get the same name
       */
      combinedObservers[el.name] = merge(combinedObservers[el.name], el.value$);
    } else {
      /** add the value observer to the form */
      combinedObservers[el.name] = el.value$;
    }
    return combinedObservers;
  }, {});

  /**
   * Put in a default value of undefined, this signals 'no change yet'
   * Also add distinctUntilChanged here,
   * we don't need to fire off anything above if there are no
   * changes in an input, this takes in account that there might
   * be multiple inputs with the same name (radio's for example)
   * this makes sure the above logic will not go haywire.
   */
  return Object.entries(inputObservers).reduce(
    (all, [name, obs]: [string, Observable<any>]) => {
      all[name] = obs.pipe(
        startWith(undefined),
        distinctUntilChanged()
      );
      return all;
    },
    {}
  );
}
