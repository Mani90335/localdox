:::question{#reach type=mcq marks=1}
In this graph, which node can you reach from **S**?

```mermaid
flowchart LR
  S --> A
  A --> B
  C --> S
```

- C
- B
- Neither
:::

:::solution{#reach answer=B}
Follow the arrows: S → A → B. The edge between C and S points into S, so C is not reachable.

```mermaid
flowchart LR
  S -->|1| A
  A -->|2| B
```
:::

:::question{#det type=nat marks=1}
Find $\det\begin{pmatrix} 3 & 1 \\ 2 & 4 \end{pmatrix}$.
:::

:::solution{#det answer=10}
$\det = 3 \cdot 4 - 1 \cdot 2 = 12 - 2 = 10$.
:::

:::question{#cond type=mcq marks=1}
Two fair coins are tossed. Given that at least one is heads, what is the probability both are heads?

- $\frac{1}{4}$
- $\frac{1}{3}$
- $\frac{1}{2}$
:::

:::solution{#cond answer=B}
"At least one head" leaves HH, HT, TH: three equally likely outcomes. Only HH has two heads, so $P = \frac{1}{3}$.
:::
