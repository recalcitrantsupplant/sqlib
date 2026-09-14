# UI Components Guide

This document provides an overview of all installed shadcn/ui components and how to use them in your SPARQL Query Library UI.

## 🎨 Installed Components (18 Total)

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

#### **SearchSelect** — the app's entity picker
Location: `src/components/shared/SearchSelect.vue`

Prefer this over `Select` and over a native `<select>` **whenever the options
are named entities** — backends, data graphs, tuple sets, argument sets,
queries, libraries. It is a text box you type into: options are fuzzy-filtered
and ranked (`src/lib/fuzzy.ts`), matched characters highlighted, arrows and
Enter to choose. A short fixed vocabulary (a format, a sort order, a flow type)
stays a plain `<select>` or a `SegmentedToggle` — there is nothing to spell.

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

`variant="bare"` drops the box for callers that already draw one (a header
strip). Choosing the empty row emits `''`, which is what a caller reading a
`<select>`'s `value` already handled.

In tests: click the field, then click a row — `tests/e2e/search-select.ts` has
`chooseSearchOption(page, testId, label)` for Playwright; unit tests click
`[data-testid="<testId>-option"]`.

#### **Filtering a pane that keeps its own order**
`fuzzyMatches(query, name, ...details)` from `src/lib/fuzzy.ts`

The sidebars, trees and tables that filter in place — the section list, the
navigation tree, backends, callables, the notebook, prefix rows — use the
predicate rather than `fuzzyFilter`, because their order is already decided
(clustered by kind or tag, sorted by name) and a filter should remove rows, not
shuffle them. Fuzzy on the name; a description, endpoint or namespace passed
after it is a plain substring test, since a subsequence spread across prose or
a URL matches nearly everything.

`useDataTable` is the one filter that stays substring throughout: it searches
result *values*, where a literal fragment of an IRI is what you mean.

#### **FilterBox** — the same idea over a list
Location: `src/components/shared/FilterBox.vue`

For lists that are already on screen (a selector dialog, a picker panel, an
axis of checkboxes): the box is shared, the filtering stays in the caller
through `fuzzyFilter`, and it appears only once a list is long enough that
reading it is the slow part.

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

## 🎯 Common Use Cases for SPARQL Query Library

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

## 🚀 Quick Reference

### Import Patterns

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

## 📚 Additional Resources

- **shadcn/ui Vue Docs**: https://shadcn-vue.com
- **Reka UI Docs**: https://reka-ui.com
- **Lucide Icons**: https://lucide.dev
- **Tailwind CSS v4**: https://tailwindcss.com

---

## 💡 Tips

1. **Use `as-child` prop** when you need to pass custom components to trigger slots
2. **Toast notifications** work great for save confirmations and error messages
3. **Combine Dialog + Form** components for create/edit modals
4. **Use Skeleton** components while loading data
5. **DropdownMenu** is perfect for row actions in tables
6. **Tabs** are ideal for query editor, results, and history views
7. **Accordion** works well for collapsible sidebar navigation
