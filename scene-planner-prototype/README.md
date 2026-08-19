# Disguise Stage Planner: локальный прототип

Это независимый локальный прототип будущего плагина Disguise Designer. Он работает без установки зависимостей: откройте `index.html` в браузере или поднимите любой локальный HTTP-сервер в этой папке.

В прототипе есть один Stage с размерами ширины и глубины, затем можно добавить LED-экраны, поверхности, камеры, проекторы и световые приборы через ПКМ в свободной точке плана. Объект из контекстного меню появляется в выбранной мировой координате. У экрана и поверхности сразу активируется ширина, Enter переводит на высоту; у нового проектора видимая точка `Look At` следует за курсором до следующего клика. `Ctrl + drag`, `Ctrl+C` и `Ctrl+V` создают копии. `Shift + click` выбирает все объекты того же типа для общего перемещения. Слева остаётся компактный список с top-view иконками, а физические параметры активного объекта показываются одной полосой над планом. Камера, проектор и световой прибор вращаются внешней круговой ручкой. Числа можно вводить вручную, менять стрелками или колесом. Колесо над планом управляет масштабом. Планы v11 сохраняются локально, а «JSON» создаёт переносимый файл.

Переключатель `LIVE` использует официальный WebSocket Live Update адаптер. Внутренние Python/HTTP функции сохранены для inspection/create/delete; HTTP-таймер не выдаётся за Live Update.

Официальный Live Update подключается через `ws://<director>/api/session/liveupdate` с сообщениями `subscribe`, `valuesChanged` и `set`. Если окно Designer не предоставляет WebSocket, LIVE отключается с понятным статусом, а JSON export остаётся доступен.

Кнопка «Clear plan» очищает только локальный план после подтверждения. Объекты Designer остаются нетронутыми.

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

The current runtime uses English Designer-facing labels. Supported equipment is `LedScreen`, `DmxScreen`, `Screen2` projection surface, `FixtureGroup` DMX light, `Projector`, and `Camera`; MR sets and skeletons are intentionally ignored. The open Designer project is imported on startup and is authoritative: typed collections and physical `stage.children` are reconciled by UID/path, while internal and non-physical helper entities are ignored. With LIVE enabled, new Planner objects are created through one Python API call and then bound to WebSocket updates; new or deleted objects in Designer are detected through Stage collection subscriptions and reconciled into the plan. Explicit deletion requires confirmation and removes only the selected resource. Stage is the single centred plan boundary with width/depth only. Object Y remains an absolute world coordinate, and projector config rotations are read-only adapter data. Selecting or previewing a projector target surface highlights that surface on the plan. Designer resource names follow planner names without `dsg-`.
