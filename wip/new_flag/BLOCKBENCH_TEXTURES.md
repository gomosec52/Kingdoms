# Как увидеть модель со всеми текстурами в Blockbench

## Способ 1 (лучший для просмотра)

Не создавай **Bedrock Entity**.

1. Blockbench → **File → Open**
2. Открой `model.gltf` или `model_wind.gltf`
3. Формат останется glTF / Generic — материалы и все 6 текстур подхватятся сами

Именно так модель выглядит «как задумано». Вкладки **Bedrock Entity** для предпросмотра glTF не подходит: там один UV-набор и текстуры надо вешать руками.

## Способ 2 (у тебя на скрине — уже Bedrock Entity)

На скрине 6 текстур, почти все названы `texture` — из-за этого непонятно, что к чему.

В папке `textures/` текстуры переименованы:

| Файл | Куда вешать (группы в Outliner) |
|------|----------------------------------|
| `0_pole_wood.png` | `Stik`, `Stik Z`, `Stik Y`, `Stik W` |
| `1_crossbar_wood.png` | `Wooden` |
| `2_banner_upper.png` | `Upper` |
| `3_banner_icon.png` | `Top of the icon`, `Bottom of the icon` |
| `4_banner_lower.png` | `Lower` |
| `5_banner_middle.png` | `Average` |

Как назначить в Bedrock Entity:

1. В **Outliner** кликни группу/кубы (например `Upper`)
2. В панели **Textures** кликни нужную текстуру
3. ПКМ по текстуре → **Apply to Selected Elements**  
   (или кнопка Apply / иконка кисти — в зависимости от версии Blockbench)
4. Повтори для каждой группы из таблицы

Если текстура «не садится» по UV — это нормально для конверта glTF→Bedrock: для игры потом нужна одна atlas-текстура. Для **просмотра** используй Способ 1.
