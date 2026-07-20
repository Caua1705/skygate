# _quarentena

Arquivos SEM nenhum importador (nem no app, nem nos testes) na data da
reorganizacao. Nao foram apagados por duvida de uso futuro.

- utils/debounce.js  — helper `debounce()`. O app usa um debounce inline
  proprio (`_searchDebounce` em src/app/events.js), nunca este modulo.
- utils/strings.js   — helper `normalizeText()`. O app usa `norm()` em
  src/utils/format.js, nunca este modulo.

Para restaurar: mova de volta para src/utils/ e importe normalmente.
