"""Independent synthetic training contexts; never reads evaluation queries or answers."""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
system=json.loads((ROOT/'configs/prompt.json').read_text())['system']
root=ROOT/'data/training-v2';root.mkdir(parents=True,exist_ok=True)
# Split by disjoint synthetic garment identities, names and color/occasion families.
settings={'train':(['white','blue','khaki','black'],['casual','formal'],8),
 'validation':(['green','rose'],['dinner'],4), 'test':(['navy','sand'],['casual'],4)}
for split,(colors,occasions,repetitions) in settings.items():
 rows=[]
 for color in colors:
  for occasion in occasions:
   for index in range(repetitions):
    top=f'train-{split}-{color}-{occasion}-{index}-shirt';bottom=f'train-{split}-{color}-{occasion}-{index}-pants'
    wardrobe=[{'id':top,'name':f'{color.title()} cotton shirt {index}','category':'tops','description':f'{color.title()} shirt for {occasion}.'},
      {'id':bottom,'name':f'{color.title()} trousers {index}','category':'bottoms','description':f'{color.title()} trousers for {occasion}.'}]
    category_only=index%4==1;no_match=index%4==2;ambiguous=index%4==3
    query=(f'Classify the {color} shirt without selecting an outfit.' if category_only else
      f'Only a purple silk scarf for {occasion} event number {index}.' if no_match else
      f'Help me choose something for request number {index} in {split} {color}.' if ambiguous else
      f'Choose the {color} shirt and {color} trousers for a {occasion} event {index}.')
    query += f' Reference {split}-{len(rows):03d}.'
    ids=[] if category_only or no_match or ambiguous else [top,bottom]
    output={'answer':f'The shirt is a top.' if category_only else 'No matching scarf exists in this wardrobe.' if no_match else
      'Please specify colors, garments or an occasion.' if ambiguous else f'Combine the {color} shirt with the {color} trousers for your {occasion} event.',
      'itemIds':ids,'occasion':occasion if ids else '', 'categories':['tops'] if category_only else ['tops','bottoms'] if ids else []}
    context={'message':query,'preferredCategories':[],'wardrobe':wardrobe,'selectionPlan':ids,
      'preferences':{'intent':'category' if category_only else 'unsupported' if no_match else 'clarify' if ambiguous else 'outfit'}}
    rows.append({'id':f'v2-{split}-{len(rows):03d}','source':'independent-authored-training-v2','scenario':f'{split}-{color}-{occasion}-{index}',
      'messages':[{'role':'system','content':system},{'role':'user','content':json.dumps(context)},{'role':'assistant','content':json.dumps(output)}]})
 (root/f'{split}.jsonl').write_text('\n'.join(json.dumps(row) for row in rows)+'\n')
print({p.stem:len(p.read_text().splitlines()) for p in root.glob('*.jsonl')})
# The config uses the training-compatible pinned Transformers base, never the GGUF file.
p=ROOT/'configs/lora.json';cfg=json.loads(p.read_text());cfg.update({'data_dir':'data/training-v2','checkpoint_every':4,'output_dir':'runs/fashion-lora-v2'});p.write_text(json.dumps(cfg,indent=2)+'\n')
