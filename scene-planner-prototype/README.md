# Disguise Scene Planner: локальный прототип

Это независимый локальный прототип будущего плагина Disguise Designer. Он работает без установки зависимостей: откройте `index.html` в браузере или поднимите любой локальный HTTP-сервер в этой папке.

В прототипе можно задать размеры помещения и сцены, затем добавить LED-экраны, поверхности, камеры, проекторы и световые приборы из верхней панели или через ПКМ в свободной точке плана. Объект из контекстного меню появляется в выбранной мировой координате. У экрана и поверхности сразу активируется ширина, Enter переводит на высоту; у нового проектора видимая точка `Look At` следует за курсором до следующего клика. `Ctrl + drag` создаёт и тащит копию, `Shift + click` выбирает все объекты того же типа для общего перемещения. Слева остаётся только компактный список, а физические параметры активного объекта показываются одной полосой над планом. Проектор содержит положение линзы и видимую цель/поверхность без пользовательских rotation-полей. LED-экран переключается между вводом разрешения, PPI и шага пикселя; остальные значения рассчитываются автоматически. Числа можно вводить вручную, менять стрелками или колесом. Колесо над планом управляет масштабом. Планы v10 сохраняются локально, а «JSON» создаёт переносимый файл.

Переключатель `LIVE` использует официальный WebSocket Live Update адаптер. Текущий `Synchronize` по-прежнему использует Python Execution API только по явному действию пользователя; HTTP-таймер не выдаётся за Live Update.

Главная кнопка «Экспортировать сцену» не обещает запись в Designer, пока адаптер не подключён. Она предлагает обновить текущую сцену или создать новый чистый набор, затем показывает операции `создать`, `обновить`, `без изменений`, `ручные: оставить` и `оставшиеся в Designer`. Узнаваемые стандартные объекты можно принять на месте. Их удаление доступно только отдельным списком с чекбоксами и вторым подтверждением.

Официальный Live Update подключается через `ws://<director>/api/session/liveupdate` с сообщениями `subscribe`, `valuesChanged` и `set`. Если окно Designer не предоставляет WebSocket, LIVE отключается с понятным статусом, а ручной экспорт остаётся доступен.

Кнопка «Очистить сцену» очищает только локальный план после подтверждения. Уже экспортированные объекты Designer остаются нетронутыми и отображаются как оставшиеся объекты при следующей синхронизации.

Внутри Designer адаптер отправляет изменения через Python Execution API (`/api/session/python/execute`). Локальный тест по умолчанию использует Designer API `http://127.0.0.1`; адрес можно переопределить через `window.DISGUISE_API_ORIGIN`. Python Execution API предназначен для редких функциональных операций вроде создания объектов, а не для постоянного polling.

## Контракт адаптера Designer

Официальный Plugin API должен предоставить глобальный `window.disguiseSceneAdapter` с методами:

```js
{
  capabilities: { liveUpdate: true, liveTransport: "websocket", httpSync: true },
  inspectScene: async () => ({ objects: [{ id: "designer-id", type: "surface" }], floorY: 0 }),
  createObject: async (payload) => ({ designerId: "designer-id" }),
  updateObject: async (designerId, changedFields, designerPath) => undefined,
  deleteObjects: async (confirmedStandardIds) => undefined
}
```

`createObject` и `updateObject` получают только управляемые или явно принятые данные. `deleteObjects` вызывается только для выбранных стандартных объектов; объекты, исчезнувшие из плана, остаются в Designer.

Полный запуск и тесты описаны в корневом `TESTING.md`.

## Current interface contract

The current runtime uses English Designer-facing labels. The open Designer project is imported on startup and is authoritative: typed collections and physical `stage.children` are reconciled by UID/path, while internal and non-physical helper entities are ignored. The `Stage` checkbox controls whether the plan has a Stage footprint; dimensions appear before numeric position fields, and synchronization updates only the safe Designer floor position plus a managed internal cube. Stage position is numeric-only. Object-relative height is measured from the Designer floor mark, while projector config rotations are read-only adapter data and are never normalized. Selecting or previewing a projector target surface highlights that surface on the plan. Missing mapped objects are not recreated automatically, and Designer resource names follow planner names without `dsg-`. `Synchronize` remains enabled for explicit HTTP/Python export; LIVE uses the WebSocket adapter when the host exposes it.
