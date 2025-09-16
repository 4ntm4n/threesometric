# CONTRACT.md: Recept, State Manager & Kalkylator

## 1. Principer

-   **Schematiskt läge:** Grafens `world`-positioner (`base`+`offset`) är endast för ritning och interaktion, inte för skala.
-   **Metrisk representation:** Beräknas "on-demand" från receptet och sparas aldrig tillbaka till grafen.
-   **Full Recalculation:** Varje måttändring kan trigga en komplett ny beräkning av den metriska modellen från grunden.
-   **Signal:** Endast `graph.setEdgeDimension()` emitterar händelsen "dimension changed".
-   **En ankare:** Exakt en nod i en sammanhängande graf agerar som absolut startpunkt (`isAnchor: true`).

## 2. Recept (Data & Metadata i `graph.js`)

### Node

-   `id`: `string`
-   `base`: `{x, y, z}` (schematisk position)
-   `offset`: `{x, y, z}` (schematisk position)
-   `meta`:
    -   `isAnchor?: boolean` (Exakt en per sammanhängande graf).
    -   `topo: 'endpoint' | 'bend' | 'tee' | 'straight' | 'junction'` (Från `classifyNode`).
    -   `degreeCenter: number`, `risers: string[]`, `riserRole?: 'top' | 'bottom' | null`.
    -   `tee?: { runner: [edgeId, edgeId], branch: edgeId, planeRef?: PlaneRef }`.
    -   `bendAngleRad?: number` (Endast för `topo: 'bend'`).

### Edge

-   `id`, `a`, `b`, `kind`: `'center' | 'construction'`
-   `spec?`: `{ od?, wt?, material? }`
-   `dim?`: `{ valueMm: number | null, mode: 'aligned' | 'axisX' | 'axisY' | 'axisZ', label?, source: 'user' | 'derived', userEditedAt?, derivedFrom?, derivedAt?, conflict? }`
-   `meta?` (Constraints):
    -   **Absolut (valfritt, max 1 per system):** `axisLock?: 'X' | 'Y' | 'Z'`
    -   **Relativa (föredras):**
        -   `angleTo?: { ref: edgeId, deg: number }`
        -   `perpTo?: { ref: edgeId }` (Förkortning för `angleTo: { ref, deg: 90 }`)
        -   `parallelTo?: { ref: edgeId }`
        -   `coplanarWith?: PlaneRef` (Gör riktningen entydig i 3D).

### PlaneRef (Definition av ett arbetsplan)

-   `{ type: 'byEdges', refs: [edgeIdA, edgeIdB] }`
-   `{ type: 'byEdgeUp', ref: edgeId, up: 'globalUp' }`
-   `{ type: 'byNormal', n: {x, y, z}, through: nodeId }`

**Notera:** UI-verktyget som "vrider in" modellen vid ritning sparar endast de resulterande relativa relationerna (`angleTo`, `perpTo`, `planeRef`), inte den temporära rotationen.

## 3. State Manager (`stateManager.js`)

### API

-   `isGraphSolvable(graph): boolean`
-   `checkGraphSolvable(graph): { ok: boolean, reason?: string, details?: any }`

### Krav (sammanfattning)

1.  **Ankare:** Exakt en nod har `isAnchor: true`.
2.  **Absolut Referens:** Minst en kant nära ankaret etablerar en initial 3D-riktning (antingen via `axisLock` eller en kedja som implicit fixerar den första "framen").
3.  **Traversering:** Varje ny nod måste kunna placeras entydigt via:
    -   **Primär metod:** `längd` (`edge.dim.valueMm`) + `riktning` från relativa constraints (`angleTo`/`perpTo`/`parallelTo` + `coplanarWith`).
    -   **Fallback:** Triangulering (minst två längder till kända noder) + en `planeRef` för att välja rätt punkt.
4.  **Sammanhängande:** Alla noder i grafen kan nås från ankaret.

### Diagnoskoder (exempel)

-   `anchor_count`
-   `no_absolute_reference`
-   `insufficient_constraints_at_node`
-   `disconnected_subgraph`
-   `ambiguous_location`
-   `dimension_missing`

## 4. Kalkylator (`calculator.js`)

### API

-   `calculateMetricData(graph): Map<NodeId, {x, y, z}> | null` (returnerar i mm)

### Ansvar

1.  Startar vid ankarnoden med position `{0,0,0}` och en initial "frame" (lokalt koordinatsystem).
2.  Använder **framåtkinematik**:
    -   Propagerar utåt längs kanterna. För varje ny nod härleds dess riktning via relativa constraints och skalas med längden.
    -   Hanterar `tee` (vinkelrät + `planeRef`), `bend` (vinkel + `planeRef`), och `straight` (180°).
3.  Använder triangulering endast som en fallback om direkt riktningsinformation saknas.
4.  **Skriver aldrig tillbaka** data till det ursprungliga `graph`-objektet. Returnerar `null` om någon nod inte kan placeras entydigt.

## 5. Metrisk Vy & Export

-   **Metrisk Vy:** En separat `metricViewGroup` i `drawManager`. Den byggs om från grunden via Kalkylatorn vid varje `onEdgeDimensionChanged`-händelse, förutsatt att `isGraphSolvable` är `true`. En toggle växlar mellan schematisk och metrisk vy.
-   **Export:** Funktionen `exportSystemContract(graph)` returnerar `null` eller ett objekt:
    ```json
    {
      "schematicGraph": { ... },
      "metricRepresentation": { "n1": {"x":0,"y":0,"z":0}, ... }
    }
    ```

## 6. Minsta testsamling

-   **A:** En diagonal stam med ett vinkelrätt T-avstick (definierat med `perpTo` och `planeRef`). Ska vara `solvable`.
-   **B:** Ett system med två böjar med definierade, icke-90-graders vinklar (via `angleTo`). Ska vara `solvable`.
-   **C:** En blandad modell där en T-korsning saknar `planeRef`, vilket gör positionen tvetydig. Ska returnera `reason: 'ambiguous_location'` tills planet anges.
