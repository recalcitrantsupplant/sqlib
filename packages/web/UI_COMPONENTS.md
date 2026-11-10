# UI Components Guide

The shadcn/ui components in `src/components/ui/`, the shared pickers and filters
built on them, and how to use each one in the sqlib UI.

## Installed components (18)

### Form Components

#### **Button**
Location: `src/components/ui/button/Button.vue`

```vue
<script setup>
import { Button } from '@/components/ui/button'
</script>

<template>
  <!-- Variants -->
  <Button>Default</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="destructive">Delete</Button>
  <Button variant="outline">Outline</Button>
  <Button variant="ghost">Ghost</Button>
  <Button variant="link">Link</Button>

  <!-- Sizes -->
  <Button size="sm">Small</Button>
  <Button size="default">Default</Button>
  <Button size="lg">Large</Button>
  <Button size="icon">🔍</Button>
</template>
```

#### **Input**
Location: `src/components/ui/input/Input.vue`

```vue
<script setup>
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
</script>

<template>
  <div>
    <Label for="query-name">Query Name</Label>
    <Input id="query-name" placeholder="Enter query name..." />
  </div>
</template>
```

#### **Textarea**
Location: `src/components/ui/textarea/Textarea.vue`

```vue
<script setup>
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
</script>

<template>
  <div>
    <Label for="sparql">SPARQL Query</Label>
    <Textarea
      id="sparql"
      placeholder="SELECT * WHERE { ?s ?p ?o }"
      rows="10"
    />
  </div>
</template>
```

#### **Select**
Location: `src/components/ui/select/`

```vue
<script setup>
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
</script>

<template>
  <Select>
    <SelectTrigger>
      <SelectValue placeholder="Select a library..." />
    </SelectTrigger>
    <SelectContent>
      <SelectGroup>
        <SelectLabel>Libraries</SelectLabel>
        <SelectItem value="lib1">Library 1</SelectItem>
        <SelectItem value="lib2">Library 2</SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
```

#### **SearchSelect**: the entity picker
Location: `src/components/shared/SearchSelect.vue`

Use this for each choice of a **named entity**: backends, data graphs, tuple
sets, argument sets, queries and libraries. Do not use `Select` or a native
`<select>` for these. SearchSelect is a text box:

- it filters and ranks the options with fuzzy matching (`src/lib/fuzzy.ts`);
- it highlights the matched characters;
- the arrow keys and Enter choose an option.

For a short fixed vocabulary, such as a format, a sort order or a flow type,
use a plain `<select>` or a `SegmentedToggle`. The user has nothing to type.

```vue
<script setup>
import SearchSelect from '@/components/shared/SearchSelect.vue'
</script>

<template>
  <SearchSelect
    test-id="data-picker"
    aria-label="Data graph"
    placeholder="Choose a data graph…"
    empty-label="Choose a data graph…"   <!-- omit where the choice is mandatory -->
    :model-value="dataGraphVersionId"
    :options="dataGraphSelectOptions"    <!-- { value, label, disabled? }[] -->
    @update:model-value="(value) => (dataGraphVersionId = value || null)"
  />
</template>
```

`variant="bare"` removes the border, for a caller that draws its own, such as
a header strip. The empty row emits `''`. This is the same value as the `value`
of an empty `<select>`, so existing callers handle it.

In tests, click the field, then click a row:

- Playwright: `chooseSearchOption(page, testId, label)` in
  `tests/e2e/search-select.ts`;
- unit tests: click `[data-testid="<testId>-option"]`.

#### **Filtering a pane that keeps its own order**
`fuzzyMatches(query, name, ...details)` from `src/lib/fuzzy.ts`

Some sidebars, trees and tables filter in place: the section list, the
navigation tree, backends, callables, the notebook and the prefix rows. They
use this predicate, and not `fuzzyFilter`. Their order is already set, by kind
or tag and then by name. A filter must remove rows, and keep the order.

The predicate uses fuzzy matching on the name only. For a description, an
endpoint or a namespace after it, it uses a plain substring test. A fuzzy
subsequence matches almost all prose and URLs.

`useDataTable` is the only filter that uses substring tests for all fields. It
searches result *values*, where a user types a literal part of an IRI.

#### **FilterBox**: a filter for a list
Location: `src/components/shared/FilterBox.vue`

Use it for a list that is already on screen, such as a selector dialog, a
picker panel or an axis of checkboxes. The box is shared. The caller does the
filtering, with `fuzzyFilter`. The box appears only when the list is too long
to read quickly.

#### **Checkbox**
Location: `src/components/ui/checkbox/Checkbox.vue`

```vue
<script setup>
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
</script>

<template>
  <div class="flex items-center space-x-2">
    <Checkbox id="public" />
    <Label for="public">Make query public</Label>
  </div>
</template>
```

#### **Label**
Location: `src/components/ui/label/Label.vue`

```vue
<script setup>
import { Label } from '@/components/ui/label'
</script>

<template>
  <Label for="field">Field Label</Label>
</template>
```

---

### Dialog & Modal Components

#### **Dialog**
Location: `src/components/ui/dialog/`

```vue
<script setup>
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
</script>

<template>
  <Dialog>
    <DialogTrigger as-child>
      <Button>Create Query</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create New Query</DialogTitle>
        <DialogDescription>
          Enter the details for your new SPARQL query.
        </DialogDescription>
      </DialogHeader>

      <!-- Form content here -->

      <DialogFooter>
        <Button variant="outline">Cancel</Button>
        <Button>Create</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
```

#### **Alert Dialog**
Location: `src/components/ui/alert-dialog/`

```vue
<script setup>
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
</script>

<template>
  <AlertDialog>
    <AlertDialogTrigger as-child>
      <Button variant="destructive">Delete Query</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone. This will permanently delete the query.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
```

---

### Navigation & Menu Components

#### **Dropdown Menu**
Location: `src/components/ui/dropdown-menu/`

```vue
<script setup>
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline">Actions</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>Query Actions</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Edit</DropdownMenuItem>
      <DropdownMenuItem>Duplicate</DropdownMenuItem>
      <DropdownMenuItem>Execute</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem class="text-destructive">Delete</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
```

#### **Tabs**
Location: `src/components/ui/tabs/`

```vue
<script setup>
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
</script>

<template>
  <Tabs default-value="query">
    <TabsList>
      <TabsTrigger value="query">Query</TabsTrigger>
      <TabsTrigger value="results">Results</TabsTrigger>
      <TabsTrigger value="history">History</TabsTrigger>
    </TabsList>

    <TabsContent value="query">
      <!-- Query editor here -->
    </TabsContent>

    <TabsContent value="results">
      <!-- Results table here -->
    </TabsContent>

    <TabsContent value="history">
      <!-- Execution history here -->
    </TabsContent>
  </Tabs>
</template>
```

#### **Accordion**
Location: `src/components/ui/accordion/`

```vue
<script setup>
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
</script>

<template>
  <Accordion type="single" collapsible>
    <AccordionItem value="item-1">
      <AccordionTrigger>Query Groups</AccordionTrigger>
      <AccordionContent>
        List of query groups...
      </AccordionContent>
    </AccordionItem>

    <AccordionItem value="item-2">
      <AccordionTrigger>Queries</AccordionTrigger>
      <AccordionContent>
        List of queries...
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>
```

---

### Display Components

#### **Card**
Location: `src/components/ui/card/`

```vue
<script setup>
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>User Query</CardTitle>
      <CardDescription>Fetches all users from the database</CardDescription>
    </CardHeader>
    <CardContent>
      <code>SELECT * WHERE { ?user a :User }</code>
    </CardContent>
    <CardFooter>
      <Button>Execute</Button>
    </CardFooter>
  </Card>
</template>
```

#### **Table**
Location: `src/components/ui/table/`

```vue
<script setup>
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
</script>

<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Name</TableHead>
        <TableHead>Library</TableHead>
        <TableHead>Last Modified</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>User Query</TableCell>
        <TableCell>Core</TableCell>
        <TableCell>2024-10-12</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
```

#### **Badge**
Location: `src/components/ui/badge/Badge.vue`

```vue
<script setup>
import { Badge } from '@/components/ui/badge'
</script>

<template>
  <!-- Variants -->
  <Badge>Default</Badge>
  <Badge variant="secondary">Secondary</Badge>
  <Badge variant="destructive">Error</Badge>
  <Badge variant="outline">Draft</Badge>
</template>
```

#### **Separator**
Location: `src/components/ui/separator/Separator.vue`

```vue
<script setup>
import { Separator } from '@/components/ui/separator'
</script>

<template>
  <div>
    <div>Section 1</div>
    <Separator class="my-4" />
    <div>Section 2</div>
  </div>
</template>
```

---

### Feedback Components

#### **Sonner (Toast)**
Location: `src/components/ui/sonner/Sonner.vue`

**Step 1:** Add Sonner to your app.vue or layout:

```vue
<script setup>
import { Toaster } from '@/components/ui/sonner'
</script>

<template>
  <div>
    <NuxtPage />
    <Toaster />
  </div>
</template>
```

**Step 2:** Use toast in any component:

```vue
<script setup>
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'

function saveQuery() {
  // Save logic...
  toast.success('Query saved successfully!')
}

function deleteQuery() {
  toast.error('Failed to delete query')
}

function showInfo() {
  toast.info('Query is being executed...')
}
</script>

<template>
  <Button @click="saveQuery">Save</Button>
</template>
```

#### **Skeleton**
Location: `src/components/ui/skeleton/Skeleton.vue`

```vue
<script setup>
import { Skeleton } from '@/components/ui/skeleton'
</script>

<template>
  <div v-if="loading" class="space-y-2">
    <Skeleton class="h-4 w-[250px]" />
    <Skeleton class="h-4 w-[200px]" />
    <Skeleton class="h-4 w-[150px]" />
  </div>

  <div v-else>
    <!-- Actual content -->
  </div>
</template>
```

---

## Common use cases

### 1. Query Editor Page

```vue
<script setup>
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'vue-sonner'

function executeQuery() {
  toast.info('Executing query...')
  // Execute logic
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Query Editor</CardTitle>
    </CardHeader>
    <CardContent>
      <Tabs default-value="editor">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <!-- CodeMirror here -->
          <Button @click="executeQuery" class="mt-4">Execute</Button>
        </TabsContent>

        <TabsContent value="results">
          <!-- Results table here -->
        </TabsContent>
      </Tabs>
    </CardContent>
  </Card>
</template>
```

### 2. Library Management

```vue
<script setup>
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
</script>

<template>
  <Dialog>
    <DialogTrigger as-child>
      <Button>Create Library</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create New Library</DialogTitle>
      </DialogHeader>
      <div class="space-y-4">
        <div>
          <Label for="name">Name</Label>
          <Input id="name" placeholder="Library name" />
        </div>
        <div>
          <Label for="description">Description</Label>
          <Textarea id="description" placeholder="Describe your library..." />
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
```

### 3. Query Results Table

```vue
<script setup>
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
</script>

<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Query Name</TableHead>
        <TableHead>Library</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="query in queries" :key="query.id">
        <TableCell>{{ query.name }}</TableCell>
        <TableCell>{{ query.library }}</TableCell>
        <TableCell>
          <Badge :variant="query.status === 'active' ? 'default' : 'secondary'">
            {{ query.status }}
          </Badge>
        </TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm">⋮</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem>Execute</DropdownMenuItem>
              <DropdownMenuItem class="text-destructive">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
```

---

## Quick reference

### Import patterns

```typescript
// Single component
import { Button } from '@/components/ui/button'

// Multiple related components
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'

// Utilities
import { cn } from '@/lib/utils'  // Merge Tailwind classes
import { toast } from 'vue-sonner' // Toast notifications
```

### Styling with cn()

```vue
<script setup>
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const isActive = ref(true)
</script>

<template>
  <Button
    :class="cn('w-full', isActive && 'bg-green-500')"
  >
    Submit
  </Button>
</template>
```

---

## Further resources

- **shadcn/ui Vue Docs**: https://shadcn-vue.com
- **Reka UI Docs**: https://reka-ui.com
- **Lucide Icons**: https://lucide.dev
- **Tailwind CSS v4**: https://tailwindcss.com

---

## Tips

- Use the `as-child` prop to pass a custom component to a trigger slot.
- Use a toast for a save confirmation or an error message.
- Use a Dialog with form components for a create or edit modal.
- Show a Skeleton while data loads.
- Use a DropdownMenu for the actions of a table row.
- Use Tabs for the query editor, results and history views.
- Use an Accordion for collapsible sidebar navigation.
