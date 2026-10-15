"""Authored v2 evaluation specification. Never imported by the training-data builder."""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# Fixed, explicitly synthetic test inventory; evaluator creates these only in an isolated test server.
fixtures=[
 ('eval-kurta-white','White cotton kurta','tops','White traditional kurta for casual summer spring.'),
 ('eval-shalwar-white','White shalwar','bottoms','White shalwar for casual summer spring.'),
 ('eval-kameez-green','Green kameez','tops','Green kameez for formal spring autumn.'),
 ('eval-shalwar-black','Black shalwar','bottoms','Black shalwar for formal spring autumn winter.'),
 ('eval-sherwani-navy','Navy sherwani','outerwear','Navy sherwani for formal winter autumn.'),
 ('eval-coat-black','Black wool coat','outerwear','Black coat for casual winter.'),
 ('eval-shirt-red','Red summer shirt','tops','Red casual shirt for summer.'),
 ('eval-pants-blue','Blue winter trousers','bottoms','Blue casual trousers for winter.'),
]
# query, exact accepted IDs (alternatives explicit), intent, categories, required colors by ID.
cases=[
 ('a casual white tee with khaki trousers', ['tee-classic-white','trousers-chino-khaki'],'outfit',['tops','bottoms'],{'tee-classic-white':'white','trousers-chino-khaki':'khaki'}),
 ('a formal blue shirt with charcoal trousers',['shirt-oxford-blue','trousers-tailored-charcoal'],'outfit',['tops','bottoms'],{'shirt-oxford-blue':'blue','trousers-tailored-charcoal':'charcoal'}),
 ('an indigo dress for dinner',['dress-midi-indigo'],'outfit',['dresses'],{'dress-midi-indigo':'indigo'}),
 ('a rose dress for summer',['dress-summer-rose'],'outfit',['dresses'],{'dress-summer-rose':'rose'}),
 ('a graphite tee',['tee-graphite'],'outfit',['tops'],{'tee-graphite':'graphite'}),
 ('a sand shirt for summer',['shirt-linen-sand'],'outfit',['tops'],{'shirt-linen-sand':'sand'}),
 ('an olive bomber jacket for winter',['jacket-bomber-olive'],'outfit',['outerwear'],{'jacket-bomber-olive':'olive'}),
 ('a denim jacket over a white tee',['jacket-denim','tee-classic-white'],'outfit',['outerwear','tops'],{}),
 ('a white tee with khaki trousers and an olive jacket',['tee-classic-white','trousers-chino-khaki','jacket-bomber-olive'],'outfit',['tops','bottoms','outerwear'],{}),
 ('a casual white top; no jackets and dresses',['tee-classic-white'],'outfit',['tops'],{'tee-classic-white':'white'}),
 ('a formal blue shirt; avoid pants and dresses',['shirt-oxford-blue'],'outfit',['tops'],{'shirt-oxford-blue':'blue'}),
 ('a white kurta with white shalwar for summer',['eval-kurta-white','eval-shalwar-white'],'outfit',['tops','bottoms'],{'eval-kurta-white':'white','eval-shalwar-white':'white'}),
 ('a formal green kameez with black shalwar',['eval-kameez-green','eval-shalwar-black'],'outfit',['tops','bottoms'],{'eval-kameez-green':'green','eval-shalwar-black':'black'}),
 ('a navy sherwani for winter',['eval-sherwani-navy'],'outfit',['outerwear'],{'eval-sherwani-navy':'navy'}),
 ('a casual black coat for winter',['eval-coat-black'],'outfit',['outerwear'],{'eval-coat-black':'black'}),
 ('a red shirt for summer',['eval-shirt-red'],'outfit',['tops'],{'eval-shirt-red':'red'}),
 ('blue trousers for winter',['eval-pants-blue'],'outfit',['bottoms'],{'eval-pants-blue':'blue'}),
 ('a yellow dress',[],'outfit',[],{}), ('a purple kurta',[],'outfit',[],{}),
 ('a formal white tee',[],'outfit',[],{}), ('a winter rose dress',[],'outfit',[],{}),
 ('a red silk scarf only',[],'unsupported',[],{}), ('black shoes only',[],'unsupported',[],{}),
 ('a wedding saree',[],'unsupported',[],{}), ('a blue suit',[],'unsupported',[],{}),
 ('some sneakers',[],'unsupported',[],{}), ('a traditional white kurta',['eval-kurta-white'],'outfit',['tops'],{'eval-kurta-white':'white'}),
 ('a Pakistani green kameez',['eval-kameez-green'],'outfit',['tops'],{'eval-kameez-green':'green'}),
 ('explain which category a denim jacket belongs to, without picking an outfit',[],'category',['outerwear'],{}),
 ('classify a kurta without picking an outfit',[],'category',['tops'],{}),
 ('classify shalwar without picking an outfit',[],'category',['bottoms'],{}),
 ('which category contains a dress',[],'category',['dresses'],{}),
 ('something stylish',[],'clarify',[],{}), ('help me choose clothing',[],'clarify',[],{}),
 ('an outfit please',[],'clarify',[],{}), ('a nice look',[],'clarify',[],{}),
 ('a white tee, exclude tops',[],'outfit',[],{}),
 ('a blue shirt, no blue',[],'outfit',[],{}),
 ('a black shalwar for autumn',['eval-shalwar-black'],'outfit',['bottoms'],{'eval-shalwar-black':'black'}),
 ('an indigo denim jacket for spring',['jacket-denim'],'outfit',['outerwear'],{'jacket-denim':'indigo'}),
]
cases.extend([
 ('formal green kameez with charcoal trousers',['eval-kameez-green','trousers-tailored-charcoal'],'outfit',['tops','bottoms'],{}),
 ('a red shirt with khaki chinos for summer',['eval-shirt-red','trousers-chino-khaki'],'outfit',['tops','bottoms'],{}),
 ('a white kurta with black shalwar for spring',['eval-kurta-white','eval-shalwar-black'],'outfit',['tops','bottoms'],{}),
 ('a navy sherwani with a green kameez for autumn',['eval-sherwani-navy','eval-kameez-green'],'outfit',['outerwear','tops'],{}),
 ('a gray tee for summer',['tee-graphite'],'outfit',['tops'],{'tee-graphite':'gray'}),
 ('a green jacket for winter',['jacket-bomber-olive'],'outfit',['outerwear'],{'jacket-bomber-olive':'green'}),
 ('a formal shirt for summer',['shirt-linen-sand'],'outfit',['tops'],{}),
 ('a blue shirt with khaki pants',['shirt-oxford-blue','trousers-chino-khaki'],'outfit',['tops','bottoms'],{}),
 ('a red top and a white kurta',['eval-shirt-red','eval-kurta-white'],'outfit',['tops'],{}),
 ('a summer black coat',[],'outfit',[],{}),
])
# Distinct wording by split. This is a transparent compositional synthetic suite, not human sampling.
wrappers={'development':[('Development check: please choose ','.'),('Help me find ','.')], 'validation':[('For this validation request I need ','.'),('I would like to wear ','.')],
 'heldout':[('For today I would like ','.'),('Please help with ','. Thank you.'),('From the available wardrobe, choose ','.')]}
for split,variants in wrappers.items():
 rows=[]
 for prefix,suffix in variants:
  for index,(query,ids,intent,categories,colors) in enumerate(cases):
   if (split == 'development' and index >= 8) or (split == 'validation' and not 8 <= index < 16) or (split == 'heldout' and index < 16): continue
   rows.append({'id':f'{split}-{len(rows):03}', 'scenario':f'case-{index:02}', 'message':prefix+query+suffix,
    'expected':{'acceptableItemSets':[ids], 'intent':intent,'categories':categories,'colorsByItem':colors},
    'source':'virtualfit-authored-compositional-eval-v2'})
 (ROOT/'evaluation'/f'{split}.jsonl').write_text('\n'.join(json.dumps(x) for x in rows)+'\n')
(ROOT/'evaluation/fixtures.json').write_text(json.dumps([dict(zip(['id','name','category','description'],x)) for x in fixtures],indent=2)+'\n')
files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'evaluation').glob('*.json*') if p.name != 'manifest.json'}
(ROOT/'evaluation/manifest.json').write_text(json.dumps({'version':'fashion-eval-v2','files':files,'heldout_cases':102,'limitations':'Synthetic suite; scenario families are disjoint across evaluation splits. Paraphrases within each split are correlated. No evaluation row is a training example. Raw model and fallback are reported separately.'},indent=2)+'\n')
print('Wrote evaluation sets: development16 validation16 heldout102. No training examples were read or modified.')
