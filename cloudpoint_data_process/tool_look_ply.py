from plyfile import PlyData
import sys
if len(sys.argv) < 2:
    print("Usage: python tool_watch_ply_headline.py <input_file>")
    sys.exit(1)
input_file = sys.argv[1]
plydata = PlyData.read(input_file)


vertex = plydata['vertex']


print("Attributes in the vertex data:")
for property_name in vertex.data.dtype.names:
    print(property_name)


print("\nFirst 5 points:")
for i in range(5):
    point = {prop: vertex[prop][i] for prop in vertex.data.dtype.names}
    print(point)

# python tool_look_ply.py  ./input.ply