import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, Validators } from '@angular/forms';
import { combineLatest, map, Observable, startWith, Subject, switchMap, tap, filter } from 'rxjs';
import { ClientsService } from '../../../clients';
import { SUBSCRIPTION_STATUS_OPTIONS, SubscriptionStatus } from '../../models/subscription-status';
import { EvoValidators } from '../../../../../../helpers/forms/validators/evo-validators';
import { SKU_RATES_OPTIONS } from '../../../orders/models/sku-rates';
import { getSkuFNTypesTitle, SKU_RATES_FN_TYPES_OPTIONS, SkuFnTypes } from '../../../orders/models/sku-fn-types';
import { SubscriptionService } from '../../services/subscription.service';
import { OrdersService } from '../../../orders';
import { Sku } from '../../../orders/models/sku';
import { Client } from '../../../clients/models/client';
import { CreatedSubscriptionDto } from '../../dtos/created-subscription-dto';
import { SubscriptionInterfaceStatus } from '../../models/subscription-interface-status';
import { getDataFromOrdersCrmLink } from '../../../../../../helpers/get-data-from-orders-crm-link';

@Component({
  selector: 'app-new-subscription',
  templateUrl: './new-subscription.component.html',
  styleUrls: ['./new-subscription.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewSubscriptionComponent implements OnInit {
  private readonly validCrmUrls = [
     'https://crm.evotor.ru/auth/clients',
     'crm.evotor.ru/auth/clients',
     'clients'
  ];
  form = this.fb.group({
      clientId: [this.activatedRoute.snapshot.queryParams['clientId']],
      subscriptionStatus: [SubscriptionStatus.Init],
      paymentStatus: ['PAID'],
      evoCrmLink: ['', [EvoValidators.ordersCrmLink(this.validCrmUrls)]],
      quantity: [1, [Validators.required, EvoValidators.positiveNumber]],
      fnQuantity: [1, [Validators.required, EvoValidators.positiveNumber]],
      fn: [''],
      tariff: [''],
      monthsCount: [12],
      skuList: [[]],
  });
  readonly crmLinkErrors = {
      paramsMustBeNumber: 'Параметры ссылки customer и deal должны быть числами',
      incorrectUrl: 'Неправильный формат ссылки'
  };
  client$: Observable<Client> | null = null;
  clientSubscriptions$: Observable<CreatedSubscriptionDto[]> | null = null;
  subscriptionInterfaceStatus = SubscriptionInterfaceStatus;
  status = SubscriptionInterfaceStatus.FORM;
  subscriptionStatusOptions = SUBSCRIPTION_STATUS_OPTIONS;
  readonly skuRatesOptions = SKU_RATES_OPTIONS;
  readonly monthsCount = [1, 12, 15, 24, 36];
  readonly subscriptionCreating$ = new Subject<boolean>();
  errorsMessages = {
    positiveNumber: 'Должно быть положительным',
  };
  readonly skuRatesFNTypesOptions = SKU_RATES_FN_TYPES_OPTIONS;
  fnTypes = SkuFnTypes;
  constructor(
    private readonly activatedRoute: ActivatedRoute,
    private readonly clientsService: ClientsService,
    private readonly fb: FormBuilder,
    private readonly subscriptionService: SubscriptionService,
    private readonly ordersService: OrdersService,
  ) {}
  ngOnInit(): void {
      this.form.get('fnQuantity')?.disable();
      this.client$ = this.form.get('clientId')?.valueChanges
          .pipe(
              startWith(this.form.get('clientId')?.value),
              filter( value => !!value),
              switchMap( clientId => this.clientsService.getClient(clientId))
          ) || null;
      this.clientSubscriptions$ = this.form.get('clientId')?.valueChanges
          .pipe(
              startWith(this.form.get('clientId')?.value),
              filter( value => !!value),
              switchMap( clientId => this.subscriptionService.getClientSubscriptions(clientId)),
          ) || null;
      this.form.get('quantity')?.valueChanges.subscribe( value => this.form.get('fnQuantity')?.setValue(value));
  }

    setSkuList(): Observable<[Sku, Sku[]]> {
      const newSkusList: Sku[] = [];
      return combineLatest([
          this.ordersService.getSKUByTariffAndMonthCount(this.form.get('tariff')?.value, this.form.get('monthsCount')?.value)
              .pipe(map(skuList => skuList[0])),
          this.ordersService.allSkus$,
      ]).pipe(
          tap( ([sku, allskus]) => {
              newSkusList.push(sku);
              if(this.form.get('fn')?.value && this.form.get('fn')?.value !== getSkuFNTypesTitle(this.fnTypes.noneFn)) {
                  const fn = allskus.find(skuItem => skuItem.title === this.form.get('fn')?.value) as Sku;
                  fn.quantity = this.form.get('quantity')?.value;
                  newSkusList.push(fn);
              }

              if(sku.payload.tariffId && sku.payload.monthCount) {
                  const tariff = allskus.find(skuItem => skuItem.id === sku.payload.tariffId) as Sku;
                  tariff.quantity = +sku.quantity * +sku.payload.monthCount;
                  newSkusList.push(tariff);
              }
              this.form.get('skuList')?.setValue([...newSkusList]);
          })
      );
  }

  getLastCreatedSubscription(subscriptions: CreatedSubscriptionDto[]) {
      return subscriptions
          .reduce( (lastCreated, currentSubscription) => currentSubscription.created.getTime() > lastCreated.getTime()
              ? currentSubscription.created
              : lastCreated, new Date());
  }

  submit(): void {
      let name: string;
      this.subscriptionCreating$.next(true);
      this.setSkuList().pipe(
          switchMap( () => combineLatest([
              this.subscriptionService.createSubscription({
                  clientId: this.form.get('clientId')?.value,
                  subscriptionStatus: this.form.get('subscriptionStatus')?.value,
                  skuList: this.form.get('skuList')?.value,
                  paymentStatus: 'PAID',
              }),
              this.client$ as Observable<Client>
          ])),
          switchMap( ([subscription, client]) => {
              name = this.ordersService.generateOrderName(client.companyName);
              const {customerId, dealId} = {...getDataFromOrdersCrmLink(this.form.get('evoCrmLink')?.value)};
              return this.ordersService.createOrder(
                  name,
                  undefined,
                  client.id,
                  subscription.id,
                  'CONNECTION',
                  customerId,
                  dealId,
              );
          }),
          switchMap( order => {
              console.log(order);
              return this.ordersService.createNewBill(order.id);
          }),
      ).subscribe(() => {
          this.subscriptionCreating$.next(false);
          this.status = SubscriptionInterfaceStatus.CREATED;
      });
  }
}
