# @datamine/editor-core

Čisté prohlížečové jádro modelu Datamine V2. Vlastní revizi pracovního modelu, příkazy, výběr, undo/redo a statický registr modulů. Nemá závislost na Reactu, DOM, Three.js, síti ani databázi.

Autoritativní uložení vždy znovu validuje server. Editor Core spravuje pracovní stav a odmítá příkazy založené na zastaralé revizi.

`setSelection()` mění pouze transientní výběr: nezvyšuje doménovou revizi a
nevstupuje do undo/redo historie. `updateRoomVertex()` naopak vrací nový platný
RoomObject, přepočítá geometrickou plochu a obvod a označí tvar jako ruční
korekci. Server při uložení stále znovu ověří celý command batch i model.
